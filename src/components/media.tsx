// Lightbox 与查看器（ViewerApp）共享的媒体展示组件：
// 视频播放、缩放控制胶囊、文件信息面板。

import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaItem } from "../types";
import { openExternal, revealInFinder } from "../api";
import { CloseIcon, FitIcon } from "./icons";
import {
  formatDate,
  formatDuration,
  formatExposure,
  formatSize,
} from "../utils";

/** 视频播放（asset 协议，支持拖动进度） */
export function VideoStage({ src }: { src: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="media-error" onClick={(e) => e.stopPropagation()}>
        {t("lightbox.videoError")}
        <br />
        <span className="media-error__sub">{t("lightbox.videoErrorSub")}</span>
      </div>
    );
  }
  return (
    <video
      className="lightbox__video"
      src={src}
      controls
      autoPlay
      preload="auto"
      onError={() => setFailed(true)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** 底部悬浮缩放胶囊：− 百分比 + 适应；children 可追加按钮（如查看器的 1:1）。
 *  `pctScale`：百分比换算系数（scale=1 时显示 pctScale*100%）。查看器传
 *  "适应时的实际像素比例"，使百分比语义 = 相对原始像素（1:1 显示 100%）；
 *  Lightbox 不传（相对适应尺寸）。 */
export function ZoomBar({
  scale,
  setScale,
  reset,
  pctScale = 1,
  children,
}: {
  scale: number;
  setScale: (factor: number) => void;
  reset: () => void;
  pctScale?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="zoom-bar"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button className="zoom-bar__btn" onClick={() => setScale(1 / 1.4)} aria-label={t("lightbox.zoomOut")}>
        −
      </button>
      <span className="zoom-bar__pct">{Math.round(scale * pctScale * 100)}%</span>
      <button className="zoom-bar__btn" onClick={() => setScale(1.4)} aria-label={t("lightbox.zoomIn")}>
        +
      </button>
      <button
        className="zoom-bar__btn"
        onClick={reset}
        aria-label={t("lightbox.fit")}
        title={t("lightbox.fit")}
      >
        <FitIcon size={15} />
      </button>
      {children}
    </div>
  );
}

/** 右侧文件信息面板（EXIF/尺寸/GPS 等）。closeLabel 可覆盖关闭按钮文案。 */
export function DetailPanel({
  photo,
  onClose,
  closeLabel,
}: {
  photo: MediaItem;
  onClose: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  const dash = t("common.dash");
  const isVideo = photo.kind === "video";
  const dims = photo.width && photo.height ? `${photo.width} × ${photo.height}` : dash;
  const subtitle = isVideo
    ? [formatDuration(photo.duration), dims !== dash ? dims : ""].filter(Boolean).join(" · ") ||
      t("detail.video")
    : formatExposure(photo) || t("detail.noParams");

  // 外链必须走 openExternal：WebView 里 target="_blank" 点了毫无反应
  // （Tauri 未注册新窗口处理器，WKWebView 直接返回 nil）。href 仍然保留，
  // 让它看起来/右键复制起来都还是个正常链接。
  const gpsUrl =
    photo.gps_lat != null && photo.gps_lon != null
      ? `https://www.openstreetmap.org/?mlat=${photo.gps_lat}&mlon=${photo.gps_lon}#map=15/${photo.gps_lat}/${photo.gps_lon}`
      : null;
  const gps =
    gpsUrl && photo.gps_lat != null && photo.gps_lon != null ? (
      <a
        className="link"
        href={gpsUrl}
        onClick={(e) => {
          e.preventDefault();
          openExternal(gpsUrl).catch(() => {});
        }}
      >
        {photo.gps_lat.toFixed(5)}, {photo.gps_lon.toFixed(5)}
      </a>
    ) : (
      dash
    );

  // 配置驱动的字段表：show=false 的行（视频无关的拍摄参数）会被过滤掉
  const rows: { label: string; value: ReactNode; show?: boolean }[] = [
    { label: t("detail.field.taken_at"), value: formatDate(photo.taken_at) },
    { label: t("detail.field.dims"), value: dims },
    { label: t("detail.field.duration"), value: formatDuration(photo.duration) || dash, show: isVideo },
    { label: t("detail.field.size"), value: formatSize(photo.file_size) },
    { label: t("detail.field.format"), value: photo.ext.toUpperCase() },
    { label: t("detail.field.camera"), value: joinCamera(photo, dash) },
    { label: t("detail.field.lens"), value: photo.lens ?? dash, show: !isVideo },
    { label: t("detail.field.aperture"), value: photo.aperture ? `f/${photo.aperture}` : dash, show: !isVideo },
    { label: t("detail.field.shutter"), value: photo.shutter ?? dash, show: !isVideo },
    { label: t("detail.field.iso"), value: photo.iso ? String(photo.iso) : dash, show: !isVideo },
    {
      label: t("detail.field.focal_length"),
      value: photo.focal_length ? `${Math.round(photo.focal_length)} mm` : dash,
      show: !isVideo,
    },
    { label: t("detail.field.gps"), value: gps },
  ];

  return (
    <div className="detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail__head">
        <h2 className="detail__title" title={photo.filename}>
          {photo.filename}
        </h2>
        <button
          className="btn btn--icon"
          onClick={onClose}
          aria-label={closeLabel ?? t("detail.close")}
          title={closeLabel ?? t("detail.close")}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="detail__exposure">
        {isVideo && <span className="badge-video">{t("detail.video")}</span>}
        {subtitle}
      </div>

      <dl className="detail__grid">
        {rows
          .filter((r) => r.show !== false)
          .map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
      </dl>

      <div className="detail__path" title={photo.path}>
        {photo.path}
      </div>
      <button
        className="btn detail__reveal"
        onClick={() => revealInFinder(photo.path).catch(() => {})}
      >
        {t("detail.reveal")}
      </button>
    </div>
  );
}

function joinCamera(p: MediaItem, dash: string): string {
  const parts = [p.camera_make, p.camera_model].filter(Boolean);
  return parts.length ? parts.join(" ") : dash;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="detail__dt">{label}</dt>
      <dd className="detail__dd">{value}</dd>
    </>
  );
}
