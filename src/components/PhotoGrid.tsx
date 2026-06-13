import { forwardRef } from "react";
import { VirtuosoGrid } from "react-virtuoso";
import type { Photo } from "../types";
import { thumbUrl } from "../api";
import { formatDateShort, formatDuration } from "../utils";

interface Props {
  photos: Photo[];
  onSelect: (index: number) => void;
}

// Virtuoso 需要稳定的容器组件来承载 grid 布局
const List = forwardRef<HTMLDivElement, any>(({ className, ...props }, ref) => (
  <div ref={ref} {...props} className={`grid ${className ?? ""}`} />
));
List.displayName = "GridList";

const Item = ({ className, ...props }: any) => (
  <div {...props} className={`grid__item ${className ?? ""}`} />
);

export default function PhotoGrid({ photos, onSelect }: Props) {
  if (photos.length === 0) {
    return (
      <div className="grid-empty">
        <p>没有符合条件的照片</p>
      </div>
    );
  }

  return (
    <VirtuosoGrid
      className="grid-scroller"
      totalCount={photos.length}
      overscan={600}
      components={{ List, Item }}
      itemContent={(index) => {
        const p = photos[index];
        return (
          <button className="cell" onClick={() => onSelect(index)} title={p.filename}>
            <img
              className="cell__img"
              src={thumbUrl(p.id)}
              alt={p.filename}
              loading="lazy"
              draggable={false}
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
      }}
    />
  );
}
