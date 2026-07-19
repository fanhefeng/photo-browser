// 独立查看器窗口（"打开方式"进入）：显示单个文件 + 同目录兄弟文件切换。
// 与主浏览器 App 互不依赖，文件不必在索引里——一切以路径为中心。
//
// 视觉对齐 macOS 26 Quick Look（Liquid Glass）：
// - 窗口模式：图片铺满窗口，顶部深色玻璃条（backdrop-filter）覆盖在图上，
//   原生红绿灯已隐藏，自绘 ✕/⤢ 玻璃按钮（行为走原生 API）。
// - 全屏模式：顶栏隐藏，底部浮出完整玻璃工具条（缩放｜信息/删除｜退出/关闭），
//   鼠标静止 2.5s 自动淡出，移动/按键唤醒，悬停工具条时不消失。

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import "./App.css";

import type { MediaItem } from "./types";
import {
  listSiblings,
  originalSrc,
  setLocale,
  takePendingOpen,
  videoSrc,
  viewerItem,
  viewerPreview,
  viewerTrash,
  vpreviewUrl,
  type SiblingItem,
} from "./api";
import { DetailPanel, VideoStage, ZoomBar } from "./components/media";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExpandIcon,
  FitIcon,
  InfoIcon,
  ShrinkIcon,
  TrashIcon,
} from "./components/icons";
import { useZoom } from "./hooks/useZoom";

/** 全屏工具条自动隐藏的空闲阈值 */
const CHROME_IDLE_MS = 2500;

export default function ViewerApp() {
  const { t } = useTranslation();
  const [items, setItems] = useState<SiblingItem[]>([]);
  const [index, setIndex] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [detail, setDetail] = useState<MediaItem | null>(null);
  // empty = 目录里没有可显示的文件；error = 操作失败的提示文案，二者语义分开
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1:1（实际像素）对应的 scale；由 ViewerStage 在图片加载/窗口变化时上报
  const [scale100, setScale100] = useState<number | null>(null);
  // 全屏工具条可见性（自动隐藏）
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimer = useRef<number | undefined>(undefined);
  const barHover = useRef(false);
  const detailCache = useRef(new Map<string, MediaItem>());
  const trashing = useRef(false);
  // 实时镜像：删除的 await 期间用户可能已导航，回来后必须基于最新状态计算
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(index);
  indexRef.current = index;

  const current: SiblingItem | undefined = items[index];

  // 缩放状态放在顶层：窗口模式的缩放胶囊与全屏工具条共用
  const zoomCtl = useZoom(current?.path ?? "", scale100 !== null ? Math.min(1, scale100) : 1);
  const pctScale = scale100 ? 1 / scale100 : 1;

  // 切换文件时重置 1:1 基准（新图加载后由 recalc 重新上报）
  useEffect(() => {
    setScale100(null);
  }, [current?.path]);

  // 打开（或切换到）一个文件：重建兄弟列表并定位
  const openFile = useCallback(async (path: string) => {
    try {
      const s = await listSiblings(path);
      detailCache.current.clear();
      setItems(s.items);
      setIndex(s.index);
      setEmpty(s.items.length === 0);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // —— 挂载：语言同步 + 拉取待打开文件；热运行时收到通知再拉一次 ——
  useEffect(() => {
    setLocale(i18n.language.startsWith("zh") ? "zh" : "en").catch(() => {});
    const unLocale = listen<string>("locale-changed", (e) => {
      void i18n.changeLanguage(e.payload);
    });
    const pull = () =>
      takePendingOpen()
        .then((paths) => {
          const p = paths[paths.length - 1];
          if (p) void openFile(p);
        })
        .catch(() => {});
    void pull();
    const unOpen = listen("viewer-open-pending", pull);
    return () => {
      void unLocale.then((f) => f());
      void unOpen.then((f) => f());
    };
  }, [openFile]);

  // —— 全屏检测：macOS 进/出全屏会触发 resize 事件，动画结束后查询状态 ——
  useEffect(() => {
    const w = getCurrentWindow();
    const check = () => {
      w.isFullscreen().then(setFullscreen).catch(() => {});
    };
    check();
    const un = w.onResized(check);
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // —— 全屏工具条自动隐藏：移动/按键唤醒，静止 2.5s 淡出，悬停工具条时顺延 ——
  useEffect(() => {
    if (!fullscreen) {
      window.clearTimeout(hideTimer.current);
      setChromeVisible(true);
      return;
    }
    const schedule = () => {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (barHover.current) schedule();
        else setChromeVisible(false);
      }, CHROME_IDLE_MS);
    };
    const wake = () => {
      setChromeVisible(true);
      schedule();
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [fullscreen]);

  // —— 删除：移废纸篓，跳到下一张；删空则关窗 ——
  const handleTrash = useCallback(async () => {
    const cur = itemsRef.current[indexRef.current];
    if (!cur || trashing.current) return;
    trashing.current = true;
    try {
      await viewerTrash(cur.path);
      detailCache.current.delete(cur.path);
      // await 期间用户可能已导航：按路径重新定位被删项，别用捕获时的下标
      const latest = itemsRef.current;
      const pos = latest.findIndex((it) => it.path === cur.path);
      if (pos === -1) return;
      const next = latest.filter((_, i) => i !== pos);
      if (next.length === 0) {
        void getCurrentWindow().close();
        return;
      }
      setItems(next);
      // 被删项之后的下标整体前移；不覆盖用户在 await 期间做的导航
      setIndex((i) => Math.min(i > pos ? i - 1 : i, next.length - 1));
      setError(null);
    } catch {
      setError(t("viewer.trashFailed"));
    } finally {
      trashing.current = false;
    }
  }, [t]);

  // —— 键盘：←/→ 切换、i 信息、⌫ 删除、Esc 退出全屏或关窗 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 焦点在视频控件上时，方向键留给播放器做快进/快退
      const onVideo = (e.target as HTMLElement | null)?.tagName === "VIDEO";
      if (e.key === "ArrowLeft" && !onVideo) setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight" && !onVideo)
        setIndex((i) => Math.min(items.length - 1, i + 1));
      else if (e.key === "i" || e.key === "I") setShowInfo((v) => !v);
      else if (e.key === "Backspace" || e.key === "Delete") void handleTrash();
      else if (e.key === "Escape") {
        // 全屏时 Esc 先退出全屏（与原生一致），窗口模式才关闭
        if (fullscreen) getCurrentWindow().setFullscreen(false).catch(() => {});
        else void getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, handleTrash, fullscreen]);

  // —— 信息面板打开时按需取完整元数据（带缓存与乱序防护）——
  useEffect(() => {
    if (!showInfo || !current) {
      setDetail(null);
      return;
    }
    const cached = detailCache.current.get(current.path);
    if (cached) {
      setDetail(cached);
      return;
    }
    setDetail(null);
    let alive = true;
    viewerItem(current.path)
      .then((item) => {
        detailCache.current.set(current.path, item);
        if (alive) setDetail(item);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showInfo, current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // 相邻照片预热（WebView 会缓存 asset 响应，切换即显）
  useEffect(() => {
    [items[index - 1], items[index + 1]].forEach((n) => {
      if (n && n.kind === "photo") new Image().src = originalSrc(n.path);
    });
  }, [items, index]);

  const glassBtn = (
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    active = false
  ) => (
    <button
      className={`gbtn ${active ? "gbtn--active" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );

  const rootClass = [
    "viewer",
    fullscreen ? "viewer--fs" : "",
    fullscreen && !chromeVisible ? "viewer--idle" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <div className="viewer__body">
        <div className="lightbox__stage viewer__stage">
          {current && index > 0 && (
            <button
              className="lightbox__nav lightbox__nav--prev"
              onClick={() => setIndex(index - 1)}
              aria-label={t("lightbox.prev")}
            >
              <ChevronLeftIcon size={24} />
            </button>
          )}

          {!current ? (
            <div className="media-error">{error ?? (empty ? t("viewer.empty") : "")}</div>
          ) : current.kind === "video" ? (
            <VideoStage key={current.path} src={videoSrc(current.path)} />
          ) : (
            <ViewerStage
              key={current.path}
              item={current}
              zoomCtl={zoomCtl}
              scale100={scale100}
              onScale100={setScale100}
            />
          )}

          {current && index < items.length - 1 && (
            <button
              className="lightbox__nav lightbox__nav--next"
              onClick={() => setIndex(index + 1)}
              aria-label={t("lightbox.next")}
            >
              <ChevronRightIcon size={24} />
            </button>
          )}
        </div>

        {showInfo && detail && current && detail.path === current.path && (
          <DetailPanel
            photo={detail}
            onClose={() => setShowInfo(false)}
            closeLabel={t("viewer.hideInfo")}
          />
        )}
      </div>

      {/* 窗口模式：顶部玻璃条覆盖在图上。原生红绿灯已隐藏，
          左侧自绘 Quick Look 式单色玻璃按钮：关闭 + 全屏（原生全屏行为） */}
      {!fullscreen && (
        <div
          className="viewer__topbar"
          onMouseDown={(e) => {
            // 空白处拖动窗口；按钮自行 stopPropagation（无红绿灯，无需避让区）
            if (e.buttons === 1 && !(e.target as HTMLElement).closest("button")) {
              void getCurrentWindow().startDragging();
            }
          }}
        >
          <div className="viewer__left">
            <div className="viewer__winbtns" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="winbtn"
                onClick={() => getCurrentWindow().close()}
                aria-label={t("viewer.close")}
                title={t("viewer.close")}
              >
                <CloseIcon size={13} />
              </button>
              <button
                className="winbtn"
                onClick={() => getCurrentWindow().setFullscreen(true).catch(() => {})}
                aria-label={t("viewer.fullscreen")}
                title={t("viewer.fullscreen")}
              >
                <ExpandIcon size={12} />
              </button>
            </div>
            <span className="viewer__name" title={current?.path}>
              {current?.filename ?? ""}
            </span>
            {items.length > 0 && (
              <span className="viewer__count">
                {index + 1} / {items.length}
              </span>
            )}
          </div>
          <div className="viewer__actions" onMouseDown={(e) => e.stopPropagation()}>
            {glassBtn(t("viewer.info"), () => setShowInfo((v) => !v), <InfoIcon size={16} />, showInfo)}
            {glassBtn(t("viewer.trash"), handleTrash, <TrashIcon size={16} />)}
          </div>
        </div>
      )}

      {/* 全屏模式：底部完整玻璃工具条（自动隐藏）。
          照片含缩放组；视频只有操作组。 */}
      {fullscreen && current && (
        <div
          className={`viewer__fsbar ${chromeVisible ? "" : "viewer__fsbar--hidden"}`}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            barHover.current = true;
          }}
          onMouseLeave={() => {
            barHover.current = false;
          }}
        >
          {current.kind === "photo" && (
            <>
              {glassBtn(t("lightbox.zoomOut"), () => zoomCtl.setScale(1 / 1.4), (
                <span className="viewer__fsglyph">−</span>
              ))}
              <span className="viewer__fspct">
                {Math.round(zoomCtl.zoom.scale * pctScale * 100)}%
              </span>
              {glassBtn(t("lightbox.zoomIn"), () => zoomCtl.setScale(1.4), (
                <span className="viewer__fsglyph">+</span>
              ))}
              {glassBtn(t("lightbox.fit"), zoomCtl.reset, <FitIcon size={16} />)}
              {glassBtn(
                t("viewer.actualSize"),
                () => scale100 && zoomCtl.zoomTo(scale100),
                <span className="viewer__fsglyph viewer__fsglyph--sm">1:1</span>
              )}
              <span className="viewer__fssep" aria-hidden />
            </>
          )}
          {glassBtn(t("viewer.info"), () => setShowInfo((v) => !v), <InfoIcon size={18} />, showInfo)}
          {glassBtn(t("viewer.trash"), handleTrash, <TrashIcon size={18} />)}
          <span className="viewer__fssep" aria-hidden />
          {glassBtn(
            t("viewer.exitFullscreen"),
            () => getCurrentWindow().setFullscreen(false).catch(() => {}),
            <ShrinkIcon size={18} />
          )}
          {glassBtn(t("viewer.close"), () => getCurrentWindow().close(), <CloseIcon size={18} />)}
        </div>
      )}

      {error && current && <div className="viewer__error">{error}</div>}
    </div>
  );
}

/** 照片舞台：原图直载（WebView 原生解码，含 HEIC），失败走 sips 全分辨率兜底。
 *  缩放状态由父层传入（与全屏工具条共用）；1:1 基准通过 onScale100 上报。 */
function ViewerStage({
  item,
  zoomCtl,
  scale100,
  onScale100,
}: {
  item: SiblingItem;
  zoomCtl: ReturnType<typeof useZoom>;
  scale100: number | null;
  onScale100: (v: number) => void;
}) {
  const { t } = useTranslation();
  const [src, setSrc] = useState(() => originalSrc(item.path));
  const [failed, setFailed] = useState(false);
  const triedFallback = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const { zoom, stageRef, setScale, zoomTo, reset, bind } = zoomCtl;

  const onError = () => {
    if (triedFallback.current) {
      setFailed(true);
      return;
    }
    triedFallback.current = true;
    viewerPreview(item.path)
      // 时间戳参数绕开 WebView 对 vpreview 的长缓存（源文件更新后重转码不换名）
      .then((id) => setSrc(`${vpreviewUrl(id)}?t=${Date.now()}`))
      .catch(() => setFailed(true));
  };

  // 由舞台尺寸 + 原始尺寸算出 1:1 对应的 scale（HiDPI 换算 devicePixelRatio）。
  // 不依赖当前缩放值；ResizeObserver 覆盖窗口 resize 与信息面板开合压窄舞台两种情况。
  const recalc = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage || !img.naturalWidth) return;
    const r = stage.getBoundingClientRect();
    const ar = img.naturalWidth / img.naturalHeight;
    const fitW = Math.min(r.width, r.height * ar);
    if (fitW > 0) onScale100(img.naturalWidth / (fitW * window.devicePixelRatio));
  }, [stageRef, onScale100]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [recalc, stageRef]);

  if (failed) {
    return <div className="media-error">{t("viewer.loadFailed")}</div>;
  }

  return (
    <div className="zoom-stage" {...bind}>
      <img
        ref={imgRef}
        className="lightbox__img"
        src={src}
        alt={item.filename}
        draggable={false}
        onError={onError}
        onLoad={recalc}
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          transition: zoom.scale === 1 ? "transform 0.12s ease-out" : "none",
        }}
      />

      <ZoomBar
        scale={zoom.scale}
        setScale={setScale}
        reset={reset}
        pctScale={scale100 ? 1 / scale100 : 1}
      >
        <button
          className="zoom-bar__btn zoom-bar__btn--text"
          onClick={() => scale100 && zoomTo(scale100)}
          title={t("viewer.actualSize")}
        >
          1:1
        </button>
      </ZoomBar>
    </div>
  );
}
