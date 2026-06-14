import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import "./App.css";

import type { Facets, Filter, MediaItem } from "./types";
import { emptyFilter } from "./types";
import {
  appInfo,
  cancelScan,
  dragWindow,
  getFacets,
  pickDirectory,
  queryPhotos,
  scanDirectory,
  setLocale,
  videoSupport,
} from "./api";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import PhotoGrid from "./components/PhotoGrid";
import Lightbox from "./components/Lightbox";
import { FolderIcon, GalleryGlyph } from "./components/icons";

export default function App() {
  const { t } = useTranslation();
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(emptyFilter());
  const [photos, setPhotos] = useState<MediaItem[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  // 扫描完成后 +1，触发重新查询（避免事件监听里捕获到过期的 refresh）
  const [reloadKey, setReloadKey] = useState(0);
  // 侧边栏宽度（可拖拽调整，记忆到 localStorage）
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebarWidth"));
    return saved >= 180 && saved <= 480 ? saved : 240;
  });
  const [resizing, setResizing] = useState(false);

  // —— 启动时检测视频工具是否可用，并打印环境/目录信息 ——
  useEffect(() => {
    videoSupport()
      .then(setVideoOk)
      .catch(() => setVideoOk(true));
    appInfo()
      .then((info) =>
        console.info(
          `[环境] ${info.env}\n数据目录: ${info.data_dir}\n缓存目录: ${info.cache_dir}\n日志目录: ${info.log_dir}\n索引库: ${info.db_path}`
        )
      )
      .catch(() => {});
    // 同步实际语言给后端，让原生菜单跟随
    setLocale(i18n.language.startsWith("zh") ? "zh" : "en").catch(() => {});
    // 监听原生菜单的语言切换，同步前端 i18n
    const un = listen<string>("locale-changed", (e) => {
      i18n.changeLanguage(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // —— 监听扫描进度事件 ——
  useEffect(() => {
    const unlistenProgress = listen<{ done: number; total: number }>(
      "scan-progress",
      (e) => setProgress(e.payload)
    );
    const unlistenDone = listen<{
      processed: number;
      total_files: number;
      cancelled: boolean;
      failed: number;
    }>("scan-done", (e) => {
      setScanning(false);
      setProgress(null);
      setReloadKey((k) => k + 1);
      const failed = e.payload?.failed ?? 0;
      const cancelled = e.payload?.cancelled ?? false;
      // 取消时不提示失败数（取消的扫描本就不完整）
      setNotice(
        !cancelled && failed > 0
          ? i18n.t("error.filesUnprocessed", { count: failed })
          : null
      );
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, []);

  // —— 拉取照片列表 + 分面（带防抖，避免连续勾选时频繁查询）——
  const debounceRef = useRef<number | undefined>(undefined);
  // 请求序号：只采纳最新一次请求的响应，丢弃在途的过期响应（防乱序覆盖）
  const reqIdRef = useRef(0);
  const refresh = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const myId = ++reqIdRef.current;
      const f = { ...filter, root: rootPath ?? undefined };
      try {
        const [list, fc] = await Promise.all([
          queryPhotos(f),
          getFacets(rootPath ?? undefined),
        ]);
        if (myId !== reqIdRef.current) return;
        setPhotos(list);
        setFacets(fc);
        setError(null);
      } catch (e) {
        if (myId !== reqIdRef.current) return;
        setError(i18n.t("error.loadFailed", { msg: String(e) }));
      }
    }, 120);
  }, [filter, rootPath]);

  useEffect(() => {
    if (rootPath) refresh();
    return () => window.clearTimeout(debounceRef.current);
  }, [filter, rootPath, refresh, reloadKey]);

  // —— 选目录并扫描 ——
  const handleOpen = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    setRootPath(dir);
    setFilter(emptyFilter());
    // 切换目录时清空上一目录的网格/分面与大图，避免短暂残留与误点
    setPhotos([]);
    setFacets(null);
    setLightboxIndex(null);
    startScan(dir);
  };

  const startScan = (dir: string) => {
    setError(null);
    setNotice(null);
    setScanning(true);
    setProgress({ done: 0, total: 0 });
    scanDirectory(dir).catch((err) => {
      // err 可能是后端返回的 i18n key（如 backend.notDirectory）；仅当确为已知 key 时才翻译
      const raw = String(err);
      const msg = i18n.exists(raw) ? i18n.t(raw) : raw;
      setError(i18n.t("error.scanFailed", { msg }));
      setScanning(false);
      setProgress(null);
    });
  };

  const patchFilter = (patch: Partial<Filter>) =>
    setFilter((f) => ({ ...f, ...patch }));

  // 拖拽调整侧边栏宽度：限制在 180–480px，松手时记忆
  const startResize = (startX: number) => {
    const startW = sidebarWidth;
    let lastW = startW;
    setResizing(true);
    const onMove = (ev: MouseEvent) => {
      lastW = Math.min(480, Math.max(180, startW + ev.clientX - startX));
      setSidebarWidth(lastW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
      localStorage.setItem("sidebarWidth", String(lastW));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="app">
      {rootPath ? (
        <Toolbar
          rootPath={rootPath}
          filter={filter}
          onChange={patchFilter}
          onOpen={handleOpen}
          onRescan={() => rootPath && startScan(rootPath)}
          onCancel={() => cancelScan().catch(() => {})}
          scanning={scanning}
          progress={progress}
        />
      ) : (
        // 空状态：不显示工具栏，只留一条透明拖动条容纳红绿灯
        <div
          className="dragbar"
          onMouseDown={(e) => dragWindow(e.nativeEvent.offsetX, e.buttons)}
        />
      )}

      {!videoOk && (
        <Banner
          tone="warn"
          text={t("banner.ffmpegMissing")}
          onDismiss={() => setVideoOk(true)}
        />
      )}
      {error && <Banner tone="error" text={error} onDismiss={() => setError(null)} />}
      {notice && <Banner tone="warn" text={notice} onDismiss={() => setNotice(null)} />}

      {rootPath ? (
        <div className="body">
          <Sidebar
            width={sidebarWidth}
            facets={facets}
            filter={filter}
            onChange={patchFilter}
          />
          <div
            className={`resizer ${resizing ? "resizer--active" : ""}`}
            onMouseDown={(e) => startResize(e.clientX)}
          />
          <main className="content">
            <PhotoGrid photos={photos} onSelect={setLightboxIndex} />
          </main>
        </div>
      ) : (
        <Welcome onOpen={handleOpen} />
      )}

      {lightboxIndex !== null && photos[lightboxIndex] && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}

function Banner({
  tone,
  text,
  onDismiss,
}: {
  tone: "warn" | "error";
  text: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`banner banner--${tone}`} role="alert">
      <span className="banner__text">{text}</span>
      <button className="banner__close" onClick={onDismiss} aria-label={t("banner.close")}>
        ✕
      </button>
    </div>
  );
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="welcome">
      <GalleryGlyph />
      <h1 className="welcome__title">{t("welcome.title")}</h1>
      <p className="welcome__sub">{t("welcome.desc")}</p>
      <button className="btn btn--primary btn--lg" onClick={onOpen}>
        <FolderIcon size={17} />
        {t("welcome.open")}
      </button>
      <p className="welcome__hint">{t("welcome.formats")}</p>
    </div>
  );
}
