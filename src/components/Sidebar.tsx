import type { Facets, Filter } from "../types";

interface Props {
  facets: Facets | null;
  filter: Filter;
  onChange: (patch: Partial<Filter>) => void;
  width: number;
}

/**
 * 分组查看侧边栏：每个维度一组标签，全局单选（Tab 式）。
 * 点某个分类即只看该类；切换到别的分类会自动取消上一个；点「全部」或当前项 = 回到全部。
 * 各维度互相独立、不取交集——任何时刻只有一个分类处于激活态。
 */
export default function Sidebar({ facets, filter, onChange, width }: Props) {
  if (!facets) {
    return (
      <aside className="sidebar sidebar--empty" style={{ width }}>
        尚未加载照片
      </aside>
    );
  }

  const hasActive = !!(filter.group_dim && filter.group_key);
  const showAll = () => onChange({ group_dim: undefined, group_key: undefined });

  const select = (dim: string, key: string) => {
    // 再次点击当前激活项 = 取消（回到全部）
    if (filter.group_dim === dim && filter.group_key === key) {
      showAll();
    } else {
      onChange({ group_dim: dim, group_key: key });
    }
  };

  // 只展示有 2 个及以上分类的维度（单一分类等同“全部”，没有筛选意义）
  const groups = facets.groups.filter((g) => g.items.length > 1);

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar__head">
        <span className="sidebar__total">
          {facets.total.toLocaleString()} 张
        </span>
        {hasActive && (
          <button className="link-btn" onClick={showAll}>
            显示全部
          </button>
        )}
      </div>

      {groups.map((g) => {
        const dimActive = filter.group_dim === g.dim;
        return (
          <div className="facet" key={g.dim}>
            <div className="facet__title">{g.title}</div>
            <div className="pills">
              {g.items.map((it) => {
                const on = dimActive && filter.group_key === it.key;
                return (
                  <button
                    key={it.key}
                    className={`pill ${on ? "pill--on" : ""}`}
                    onClick={() => select(g.dim, it.key)}
                    title={it.label}
                  >
                    <span className="pill__label">{it.label}</span>
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
