import { forwardRef, useCallback } from "react";
import { VirtuosoGrid, type GridComponents } from "react-virtuoso";
import type { MediaItem } from "../types";
import { thumbUrl } from "../api";
import { formatDateShort, formatDuration } from "../utils";

interface Props {
  photos: MediaItem[];
  onSelect: (index: number) => void;
}

// Virtuoso 需要稳定的容器组件来承载 grid 布局（用库的类型，避免 any）
const gridComponents: GridComponents = {
  List: forwardRef(({ style, children, className }, ref) => (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      style={style}
      className={`grid ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  )),
  Item: ({ children, ...props }) => (
    <div {...props} className="grid__item">
      {children}
    </div>
  ),
};

export default function PhotoGrid({ photos, onSelect }: Props) {
  const itemContent = useCallback(
    (index: number) => {
      const p = photos[index];
      if (!p) return null;
      return (
        <button
          className="cell"
          onClick={() => onSelect(index)}
          title={p.filename}
          aria-label={`查看 ${p.filename}`}
        >
          <img
            className="cell__img"
            src={thumbUrl(p.id)}
            alt={p.filename}
            loading="lazy"
            draggable={false}
            onError={(e) => e.currentTarget.classList.add("cell__img--broken")}
          />
          {p.kind === "video" && (
            <>
              <span className="cell__play" aria-hidden>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M8 5v14l11-7z" fill="currentColor" />
                </svg>
              </span>
              {p.duration ? (
                <span className="cell__duration">{formatDuration(p.duration)}</span>
              ) : null}
            </>
          )}
          <div className="cell__overlay">
            <span className="cell__name">{p.filename}</span>
            <span className="cell__date">{formatDateShort(p.taken_at)}</span>
          </div>
        </button>
      );
    },
    [photos, onSelect]
  );

  if (photos.length === 0) {
    return (
      <div className="grid-empty">
        <p className="grid-empty__title">没有符合条件的照片</p>
        <span className="grid-empty__hint">试试切换左侧分类，或点「显示全部」</span>
      </div>
    );
  }

  return (
    <VirtuosoGrid
      className="grid-scroller"
      totalCount={photos.length}
      overscan={600}
      components={gridComponents}
      itemContent={itemContent}
    />
  );
}
