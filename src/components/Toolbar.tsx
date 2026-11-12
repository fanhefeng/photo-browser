import { useRef } from "react";
import Select from "./Select";
import { useTranslation } from "react-i18next";
import { dragWindow } from "../api";
import type { Filter, SortBy } from "../types";
import {
  CloseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FolderIcon,
  GearIcon,
  RescanIcon,
  SearchIcon,
} from "./icons";

interface Props {
  rootPath: string | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  onOpen: () => void;
  onRescan: () => void;
  onCancel: () => void;
  onSettings: () => void;
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
  onSettings,
  scanning,
  progress,
}: Props) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  const folderName = rootPath?.split(/[\\/]/).filter(Boolean).pop() || rootPath;

  return (
    <header
      className="toolbar"
      onMouseDown={(e) => {
        // 工具组容器也占据空白区域；只排除真正的控件及其内部元素。
        if (!(e.target instanceof Element) || e.target.closest("button, .search, .select-control")) return;
        // offsetX 相对命中的子元素，不能用它判断窗口左侧的红绿灯避让区。
        dragWindow(e.clientX - e.currentTarget.getBoundingClientRect().left, e.buttons);
      }}
    >
      <div className="toolbar__left">
        <button
          className="btn btn--open"
          onClick={onOpen}
          disabled={scanning}
          title={t("toolbar.openTitle")}
        >
          <FolderIcon />
          <span>{t("toolbar.open")}</span>
        </button>
        {rootPath && (
          <>
            <span className="toolbar__sep" />
            <span className="toolbar__path" title={rootPath} dir="auto">
              {folderName}
            </span>
            <button
              className="btn btn--icon"
              onClick={onRescan}
              disabled={scanning}
              title={t("toolbar.rescan")}
              aria-label={t("toolbar.rescan")}
            >
              <RescanIcon className={scanning ? "spin" : undefined} />
            </button>
          </>
        )}
      </div>

      {!rootPath ? null : scanning && progress ? (
        <div className="toolbar__progress">
          <div className="progress" role="progressbar" aria-label={t("grid.importing")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
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
            <label className="search__field">
              <SearchIcon className="search__icon" />
              <input
                ref={searchRef}
                className="search__input"
                type="search"
                aria-label={t("toolbar.searchPlaceholder")}
                placeholder={t("toolbar.searchPlaceholder")}
                value={filter.text ?? ""}
                onChange={(e) => onChange({ text: e.target.value })}
              />
            </label>
            {filter.text && (
              <button type="button" className="search__clear" aria-label={t("toolbar.clearSearch")}
                onClick={() => { onChange({ text: "" }); searchRef.current?.focus(); }}>
                <CloseIcon size={13} />
              </button>
            )}
          </div>
          <div className="sort">
            <Select
              label={t("toolbar.sortBy")}
              value={filter.sort_by}
              onChange={(sort_by) => onChange({ sort_by })}
              options={SORT_VALUES.map((value) => ({ value, label: t(`sort.${value}`) }))}
            />
            <button
              className="btn btn--icon"
              title={filter.sort_dir === "desc" ? t("toolbar.sortDesc") : t("toolbar.sortAsc")}
              aria-label={filter.sort_dir === "desc" ? t("toolbar.sortDesc") : t("toolbar.sortAsc")}
              onClick={() =>
                onChange({ sort_dir: filter.sort_dir === "desc" ? "asc" : "desc" })
              }
            >
              {filter.sort_dir === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </button>
          </div>
          <button
            className="btn btn--icon"
            onClick={onSettings}
            title={t("settings.title")}
            aria-label={t("settings.title")}
          >
            <GearIcon />
          </button>
        </div>
      )}
    </header>
  );
}
