import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

import type { Facets, Filter, Photo } from "./types";
import { emptyFilter } from "./types";
import {
  appInfo,
  cancelScan,
  getFacets,
  pickDirectory,
  queryPhotos,
  scanDirectory,
  videoSupport,
} from "./api";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import PhotoGrid from "./components/PhotoGrid";
import Lightbox from "./components/Lightbox";

export default function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(emptyFilter());
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoOk, setVideoOk] = useState(true);
  // 扫描完成后 +1，触发重新查询（避免事件监听里捕获到过期的 refresh）
  const [reloadKey, setReloadKey] = useState(0);

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
  }, []);

  // —— 监听扫描进度事件 ——
  useEffect(() => {
    const unlistenProgress = listen<{ done: number; total: number }>(
      "scan-progress",
      (e) => setProgress(e.payload)
    );
    const unlistenDone = listen("scan-done", () => {
      setScanning(false);
      setProgress(null);
      setReloadKey((k) => k + 1);
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, []);

  // —— 拉取照片列表 + 分面（带防抖，避免连续勾选时频繁查询）——
  const debounceRef = useRef<number | undefined>(undefined);
  const refresh = useCallback(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      const f = { ...filter, root: rootPath ?? undefined };
      try {
        const [list, fc] = await Promise.all([
          queryPhotos(f),
          getFacets(rootPath ?? undefined),
        ]);
        setPhotos(list);
        setFacets(fc);
        setError(null);
      } catch (e) {
        setError(`加载照片失败：${e}`);
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
    setScanning(true);
    setProgress({ done: 0, total: 0 });
    scanDirectory(dir).catch((err) => {
      setError(`扫描失败：${err}`);
      setScanning(false);
      setProgress(null);
    });
  };

  const patchFilter = (patch: Partial<Filter>) =>
    setFilter((f) => ({ ...f, ...patch }));

  return (
    <div className="app">
      <Toolbar
        rootPath={rootPath}
        filter={filter}
        onChange={patchFilter}
        onOpen={handleOpen}
        onRescan={() => rootPath && startScan(rootPath)}
        onCancel={cancelScan}
        scanning={scanning}
        progress={progress}
      />

      {!videoOk && (
        <Banner
          tone="warn"
          text="未检测到 ffmpeg / ffprobe，视频将无法生成封面与元数据。可通过 Homebrew 安装：brew install ffmpeg"
          onDismiss={() => setVideoOk(true)}
        />
      )}
      {error && <Banner tone="error" text={error} onDismiss={() => setError(null)} />}

      {rootPath ? (
        <div className="body">
          <Sidebar facets={facets} filter={filter} onChange={patchFilter} />
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
  return (
    <div className={`banner banner--${tone}`} role="alert">
      <span className="banner__text">{text}</span>
      <button className="banner__close" onClick={onDismiss} aria-label="关闭提示">
        ✕
      </button>
    </div>
  );
}

function Welcome({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome__card">
        <h1>本地照片浏览器</h1>
        <p>
          打开一个本地文件夹，自动解析 EXIF、生成缩略图，
          <br />
          支持照片与视频，按时间 / 相机 / 镜头 / 格式 / 定位多维度检索。
        </p>
        <button className="btn btn--primary btn--lg" onClick={onOpen}>
          打开文件夹
        </button>
      </div>
    </div>
  );
}
