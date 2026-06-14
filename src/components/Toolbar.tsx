import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import type { Filter, SortBy } from "../types";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderIcon,
  RescanIcon,
  SearchIcon,
} from "./icons";
import LangSwitch from "./LangSwitch";

interface Props {
  rootPath: string | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  onOpen: () => void;
  onRescan: () => void;
  onCancel: () => void;
  scanning: boolean;
  progress: { done: number; total: number } | null;
}

const SORT_VALUES: SortBy[] = [
  "taken_at",
  "filename",
  "file_size",
  "width",
  "iso",
  "focal_length",
];

export default function Toolbar({
  rootPath,
  filter,
  onChange,
  onOpen,
  onRescan,
  onCancel,
  scanning,
  progress,
}: Props) {
  const { t } = useTranslation();
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <header
      className="toolbar"
      onMouseDown={(e) => {
        // 仅在拖动工具栏空白区时移动窗口；排除左侧红绿灯区域（offsetX ≤ 100）
        if (
          e.target === e.currentTarget &&
          e.buttons === 1 &&
          e.nativeEvent.offsetX > 100
        ) {
          void getCurrentWindow().startDragging();
        }
      }}
    >
      <div className="toolbar__left">
        <button
          className="btn btn--open"
          onClick={onOpen}
          title={t("toolbar.openTitle")}
        >
          <FolderIcon />
          {t("toolbar.open")}
        </button>
        {rootPath && (
          <>
            <span className="toolbar__sep" />
            <span className="toolbar__path" title={rootPath}>
              {rootPath}
            </span>
            <button
              className="btn btn--icon"
              onClick={onRescan}
              disabled={scanning}
              title={t("toolbar.rescan")}
            >
              <RescanIcon className={scanning ? "spin" : undefined} />
            </button>
          </>
        )}
      </div>

      {!rootPath ? null : scanning && progress ? (
        <div className="toolbar__progress">
          <div className="progress">
            <div className="progress__bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="toolbar__progress-text">
            {progress.done}/{progress.total}
          </span>
          <button className="btn btn--sm" onClick={onCancel}>
            {t("toolbar.cancel")}
          </button>
        </div>
      ) : (
        <div className="toolbar__right">
          <div className="search">
            <SearchIcon className="search__icon" />
            <input
              className="search__input"
              type="search"
              placeholder={t("toolbar.searchPlaceholder")}
              value={filter.text ?? ""}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </div>
          <div className="sort">
            <select
              className="select"
              value={filter.sort_by}
              onChange={(e) => onChange({ sort_by: e.target.value as SortBy })}
            >
              {SORT_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`sort.${v}`)}
                </option>
              ))}
            </select>
            <button
              className="btn btn--icon"
              title={filter.sort_dir === "desc" ? t("toolbar.sortDesc") : t("toolbar.sortAsc")}
              onClick={() =>
                onChange({ sort_dir: filter.sort_dir === "desc" ? "asc" : "desc" })
              }
            >
              {filter.sort_dir === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </button>
          </div>
          <LangSwitch />
        </div>
      )}
    </header>
  );
}
