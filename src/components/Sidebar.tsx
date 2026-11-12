import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Facets, Filter } from "../types";
import { LibraryIcon } from "./icons";

interface Props {
  facets: Facets | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  width: number;
}

/** 按维度 + 分类 key 翻译标签：camera 是品牌名（数据值）不翻译，其余走 i18n */
export function facetLabel(dim: string, key: string, t: TFunction): string {
  if (key === "unknown") return t("facet.unknown");
  switch (dim) {
    case "kind":
      return t(`facet.kind.${key}`);
    case "format":
      return t(`facet.format.${key}`);
    case "gps":
      return t(`facet.gps.${key}`);
    case "year":
      return t("facet.year", { year: key });
    case "camera":
      return key;
    default:
      return key;
  }
}

/**
 * 分组查看侧边栏：每个维度一组标签，全局单选（Tab 式）。
 * 点某个分类即只看该类；切换到别的分类会自动取消上一个；点「全部」或当前项 = 回到全部。
 */
export default function Sidebar({ facets, filter, onChange, width }: Props) {
  const { t } = useTranslation();

  if (!facets) {
    return (
      <aside className="sidebar sidebar--empty" style={{ width }}>
        {t("sidebar.notLoaded")}
      </aside>
    );
  }

  const hasActive = Boolean(filter.text?.trim() || (filter.group_dim && filter.group_key));
  const showAll = () => onChange({ text: undefined, group_dim: undefined, group_key: undefined });

  const select = (dim: string, key: string) => {
    if (filter.group_dim === dim && filter.group_key === key) {
      onChange({ group_dim: undefined, group_key: undefined });
    } else {
      onChange({ group_dim: dim, group_key: key });
    }
  };

  // 只展示有 2 个及以上分类的维度（单一分类等同“全部”，没有筛选意义）
  const groups = facets.groups.filter((g) => g.items.length > 1);

  return (
    <aside className="sidebar" style={{ width }} aria-label={t("sidebar.library")}>
      <div className="sidebar__head">
        <span className="sidebar__total">{t("sidebar.library")}</span>
      </div>
      <button
        className={`pill pill--library ${!hasActive ? "pill--on" : ""}`}
        aria-pressed={!hasActive}
        onClick={showAll}
      >
        <LibraryIcon size={17} />
        <span className="pill__label">{t("sidebar.allMedia")}</span>
        <span className="pill__count">{facets.total.toLocaleString()}</span>
      </button>

      {groups.map((g) => {
        const dimActive = filter.group_dim === g.dim;
        return (
          <div className="facet" key={g.dim}>
            <div className="facet__title">{t(`facet.dim.${g.dim}`)}</div>
            <div className="pills">
              {g.items.map((it) => {
                const on = dimActive && filter.group_key === it.key;
                const label = facetLabel(g.dim, it.key, t);
                return (
                  <button
                    key={it.key}
                    className={`pill ${on ? "pill--on" : ""}`}
                    aria-pressed={on}
                    onClick={() => select(g.dim, it.key)}
                    title={label}
                  >
                    <span className="pill__label">{label}</span>
                    <span className="pill__count">{it.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
