import type { Filter, SortBy } from "../types";

interface Props {
  rootPath: string | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  onOpen: () => void;
  onRescan: () => void;
  scanning: boolean;
  progress: { done: number; total: number } | null;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "taken_at", label: "拍摄时间" },
  { value: "filename", label: "文件名" },
  { value: "file_size", label: "文件大小" },
  { value: "width", label: "分辨率" },
  { value: "iso", label: "ISO" },
  { value: "focal_length", label: "焦距" },
];

export default function Toolbar({
  rootPath,
  filter,
  onChange,
  onOpen,
  onRescan,
  scanning,
  progress,
}: Props) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <header className="toolbar">
      <div className="toolbar__left">
        <button className="btn btn--primary" onClick={onOpen}>
          打开文件夹
        </button>
        {rootPath && (
          <>
            <span className="toolbar__path" title={rootPath}>
              {rootPath}
            </span>
            <button className="btn" onClick={onRescan} disabled={scanning}>
              {scanning ? "扫描中…" : "重新扫描"}
            </button>
          </>
        )}
      </div>

      {scanning && progress ? (
        <div className="toolbar__progress">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="toolbar__progress-text">
            {progress.done}/{progress.total}
          </span>
        </div>
      ) : (
        <div className="toolbar__right">
          <input
            className="search"
            type="search"
            placeholder="按文件名搜索…"
            value={filter.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
          />
          <div className="sort">
            <select
              className="select"
              value={filter.sort_by}
              onChange={(e) => onChange({ sort_by: e.target.value as SortBy })}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn--icon"
              title={filter.sort_dir === "desc" ? "降序" : "升序"}
              onClick={() =>
                onChange({ sort_dir: filter.sort_dir === "desc" ? "asc" : "desc" })
              }
            >
              {filter.sort_dir === "desc" ? "↓" : "↑"}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
