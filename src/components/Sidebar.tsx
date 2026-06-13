import { useState } from "react";
import type { Facets, FacetItem, Filter } from "../types";

interface Props {
  facets: Facets | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
}

/** 在数组维度里切换某个值（多选筛选） */
function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

interface SectionConfig {
  key: string;
  title: string;
  items: FacetItem[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFmt?: (value: string) => string;
  show?: boolean;
}

export default function Sidebar({ facets, filter, onChange }: Props) {
  if (!facets) {
    return <aside className="sidebar sidebar--empty">尚未加载照片</aside>;
  }

  const activeCount =
    filter.years.length +
    filter.cameras.length +
    filter.lenses.length +
    filter.formats.length +
    filter.kinds.length +
    (filter.has_gps ? 1 : 0) +
    (filter.text ? 1 : 0);

  // 各筛选维度统一用配置驱动，避免重复 JSX
  const sections: SectionConfig[] = [
    {
      key: "kinds",
      title: "类型",
      items: facets.kinds,
      selected: filter.kinds,
      onToggle: (v) => onChange({ kinds: toggle(filter.kinds, v) }),
      labelFmt: (v) => (v === "video" ? "视频" : "照片"),
      show: facets.kinds.length > 1,
    },
    {
      key: "years",
      title: "拍摄时间",
      items: facets.years,
      selected: filter.years.map(String),
      onToggle: (v) => onChange({ years: toggle(filter.years, Number(v)) }),
      labelFmt: (v) => `${v} 年`,
    },
    {
      key: "cameras",
      title: "相机",
      items: facets.cameras,
      selected: filter.cameras,
      onToggle: (v) => onChange({ cameras: toggle(filter.cameras, v) }),
    },
    {
      key: "lenses",
      title: "镜头",
      items: facets.lenses,
      selected: filter.lenses,
      onToggle: (v) => onChange({ lenses: toggle(filter.lenses, v) }),
    },
    {
      key: "formats",
      title: "格式",
      items: facets.formats,
      selected: filter.formats,
      onToggle: (v) => onChange({ formats: toggle(filter.formats, v) }),
      labelFmt: (v) => v.toUpperCase(),
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__total">{facets.total.toLocaleString()} 张照片</span>
        {activeCount > 0 && (
          <button
            className="link-btn"
            onClick={() =>
              onChange({
                years: [],
                cameras: [],
                lenses: [],
                formats: [],
                kinds: [],
                has_gps: false,
                text: "",
              })
            }
          >
            清除筛选 ({activeCount})
          </button>
        )}
      </div>

      {sections
        .filter((s) => s.show !== false)
        .map((s) => (
          <Section
            key={s.key}
            title={s.title}
            items={s.items}
            selected={s.selected}
            onToggle={s.onToggle}
            labelFmt={s.labelFmt}
          />
        ))}

      <div className="facet">
        <label className="facet__row facet__row--toggle">
          <input
            type="checkbox"
            checked={filter.has_gps}
            onChange={(e) => onChange({ has_gps: e.target.checked })}
          />
          <span className="facet__label">仅看有定位的</span>
          <span className="facet__count">{facets.with_gps}</span>
        </label>
      </div>
    </aside>
  );
}

interface SectionProps {
  title: string;
  items: FacetItem[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFmt?: (value: string) => string;
}

function Section({ title, items, selected, onToggle, labelFmt }: SectionProps) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const shown = open ? items : [];

  return (
    <div className="facet">
      <button className="facet__title" onClick={() => setOpen((o) => !o)}>
        <span className={`chevron ${open ? "chevron--open" : ""}`}>›</span>
        {title}
        <span className="facet__title-count">{items.length}</span>
      </button>
      <div className="facet__list">
        {shown.map((it) => (
          <label
            key={it.value}
            className={`facet__row ${selected.includes(it.value) ? "is-active" : ""}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(it.value)}
              onChange={() => onToggle(it.value)}
            />
            <span className="facet__label" title={it.value}>
              {labelFmt ? labelFmt(it.value) : it.value}
            </span>
            <span className="facet__count">{it.count}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
