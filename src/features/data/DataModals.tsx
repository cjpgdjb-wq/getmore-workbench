import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  Download,
  GripVertical,
  Info,
  Lock,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  CAMPAIGNS,
  BRAND_CAMPAIGNS,
  addDays,
  cpaOf,
  creativeById,
  creativeMetrics,
  ctrOf,
  dataHealthOf,
  forecastPlan,
  netTotalsOf,
  orgName,
  parseDateKey,
  presetRange,
  roiOf,
  sumSeries,
  toDateKey,
  TODAY,
  type Account,
  type Campaign,
  type Channel,
  type DateRange,
  type Dimension,
  type Product,
  type ProductStatus,
  type Totals,
} from "../../data/mock";
import { fmtInt, fmtMoney, fmtPct, fmtRoi, fmtDateShort } from "../../lib/format";
import { Checkbox, Modal, Drawer, Select, StatusBadge, Switch, TrendChart, Sparkline } from "../../components/ui";
import { useWorkbench } from "../../state/workbench";
import {
  COLUMN_GROUPS,
  defaultColumnIds,
  getColumns,
  type ColumnGroupId,
} from "./columns";

/* ------------------------------------------------------------------ */
/* Custom columns                                                     */
/* ------------------------------------------------------------------ */

export function ColumnsModal({
  open,
  channel,
  dimension,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  channel: Channel;
  dimension: Dimension;
  value: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(value);
  const [group, setGroup] = useState<ColumnGroupId>("attr");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(value);
      setQuery("");
      setGroup("attr");
    }
  }, [open, value]);

  const catalog = useMemo(() => getColumns(channel, dimension), [channel, dimension]);
  const groups = useMemo(() => {
    const ids = Array.from(new Set(catalog.map((column) => column.group)));
    const order: ColumnGroupId[] = ["attr", "finance", "perf"];
    return order.filter((id) => ids.includes(id));
  }, [catalog]);

  const filteredCatalog = useMemo(
    () =>
      catalog.filter(
        (column) =>
          !query.trim() || `${column.label}${column.sub ?? ""}`.includes(query.trim()),
      ),
    [catalog, query],
  );

  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const jumpToGroup = (id: ColumnGroupId) => {
    setGroup(id);
    const target = groupRefs.current[id];
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const labelOf = (id: string) => {
    const column = catalog.find((item) => item.id === id);
    return column ? `${column.label}${column.sub ?? ""}` : id;
  };

  const toggle = (id: string, next: boolean) => {
    setDraft((prev) => {
      if (next) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((item) => item !== id);
    });
  };

  const move = (index: number, delta: number) => {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const fixedLabel = dimension === "campaign" ? "计划信息" : "账户信息";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="自定义列"
      desc="调整列表中展示的指标与顺序，配置会保存在本地浏览器"
      className="columns-modal"
      footer={
        <>
          <span className="left">已选择 {draft.length + 1} / 50 列 · 横向固定最多 5 列</span>
          <button type="button" className="btn btn-default" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>
            确定
          </button>
        </>
      }
    >
      <div className="columns-layout">
        <div className="columns-nav">
          <div className="columns-search">
            <div className="input-shell">
              <Search size={14} />
              <input placeholder="请搜索指标" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索指标" />
            </div>
          </div>
          <div className="columns-nav-list">
            {groups.map((item) => (
              <button
                key={item}
                type="button"
                className={`columns-nav-item is-group ${group === item ? "is-active" : ""}`}
                onClick={() => jumpToGroup(item)}
              >
                {COLUMN_GROUPS[item]}
              </button>
            ))}
            <div className="columns-nav-note">
              <Info size={12} />
              指标配置仅影响展示，不会修改投放数据
            </div>
          </div>
        </div>

        <div className="columns-content">
          {groups.map((item) => {
            const items = filteredCatalog.filter((column) => column.group === item);
            if (query.trim() && items.length === 0) return null;
            return (
              <div
                key={item}
                className="column-group"
                ref={(element) => {
                  groupRefs.current[item] = element;
                }}
              >
                <h3>{COLUMN_GROUPS[item]}</h3>
                <div className="column-group-title">
                  <Check size={13} />
                  {item === "attr"
                    ? dimension === "campaign"
                      ? "推广设置"
                      : "账户设置"
                    : item === "finance"
                      ? "财务指标"
                      : "基础效果"}
                </div>
                <div className="column-grid">
                  {items.map((column) => {
                    const checked = draft.includes(column.id);
                    return (
                      <label key={column.id} className={`column-check ${checked ? "is-checked" : ""}`}>
                        <Checkbox checked={checked} onChange={(next) => toggle(column.id, next)} ariaLabel={column.label} />
                        <span>
                          {column.label}
                          {column.sub}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {filteredCatalog.length === 0 && <div className="column-empty">没有匹配的指标</div>}
        </div>

        <div className="columns-picked">
          <div className="picked-head">
            已添加（{draft.length + 1}/50）
            <button type="button" className="reset btn-link" onClick={() => setDraft(defaultColumnIds(channel, dimension))}>
              重置
            </button>
          </div>
          <div className="picked-locked">
            <Lock size={13} />
            {fixedLabel}
            <span className="picked-lock-tip">固定列</span>
          </div>
          <div className="picked-note">以上指标横向固定，最多 5 个</div>
          <div className="picked-list">
            {draft.map((id, index) => (
              <div key={id} className="picked-item">
                <span className="grip" aria-hidden="true">
                  <GripVertical size={13} />
                </span>
                <span className="label">{labelOf(id)}</span>
                <button
                  type="button"
                  className="move"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="上移"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="move"
                  disabled={index === draft.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="下移"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  className="remove"
                  onClick={() => toggle(id, false)}
                  aria-label={`移除 ${labelOf(id)}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {draft.length === 0 && <div className="column-empty">还没有添加指标，从左侧勾选</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* More filters                                                       */
/* ------------------------------------------------------------------ */

export interface MoreFilters {
  costOp: "gte" | "lte" | "";
  costValue: string;
  balanceOp: "gte" | "lte" | "";
  balanceValue: string;
}

export const EMPTY_FILTERS: MoreFilters = { costOp: "", costValue: "", balanceOp: "", balanceValue: "" };

export function FiltersModal({
  open,
  channel,
  value,
  onClose,
  onApply,
}: {
  open: boolean;
  channel: Channel;
  value: MoreFilters;
  onClose: () => void;
  onApply: (next: MoreFilters) => void;
}) {
  const [draft, setDraft] = useState<MoreFilters>(value);
  const [section, setSection] = useState<"cost" | "balance">("cost");

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const opOptions = [
    { value: "gte", label: "大于等于" },
    { value: "lte", label: "小于等于" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="更多筛选"
      desc="按账户消耗、可用余额组合筛选账户，支持与搜索、关注条件叠加"
      className="filters-modal"
      footer={
        <>
          <button
            type="button"
            className="filter-reset btn-link"
            onClick={() => setDraft({ ...EMPTY_FILTERS })}
          >
            <RotateCcw size={13} /> 重置筛选项
          </button>
          <button type="button" className="btn btn-default" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>
            确定
          </button>
        </>
      }
    >
      <div className="filters-layout">
        <div className="filters-nav">
          <div className="group-label">{channel === "auction" ? "竞价账户" : "品牌账户"}</div>
          <button type="button" className={section === "cost" ? "is-active" : ""} onClick={() => setSection("cost")}>
            账户消耗
          </button>
          <button type="button" className={section === "balance" ? "is-active" : ""} onClick={() => setSection("balance")}>
            {channel === "auction" ? "竞价总可用余额" : "品牌总可用余额"}
          </button>
        </div>
        <div className="filters-content">
          <h3>{channel === "auction" ? "竞价账户" : "品牌账户"}</h3>
          {section === "cost" ? (
            <div className="filter-field">
              <label>账户消耗（统计周期内）</label>
              <div className="filter-row">
                <Select
                  value={draft.costOp}
                  options={[{ value: "", label: "请选择" }, ...opOptions]}
                  onChange={(next) => setDraft({ ...draft, costOp: next as MoreFilters["costOp"] })}
                  width={132}
                  ariaLabel="消耗比较方式"
                />
                <div className="filter-input">
                  <input
                    inputMode="decimal"
                    placeholder="请输入"
                    value={draft.costValue}
                    onChange={(event) => setDraft({ ...draft, costValue: event.target.value.replace(/[^\d.]/g, "") })}
                    aria-label="消耗金额"
                  />
                  <span className="unit">元</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="filter-field">
              <label>{channel === "auction" ? "竞价总可用余额" : "品牌总可用余额"}</label>
              <div className="filter-row">
                <Select
                  value={draft.balanceOp}
                  options={[{ value: "", label: "请选择" }, ...opOptions]}
                  onChange={(next) => setDraft({ ...draft, balanceOp: next as MoreFilters["balanceOp"] })}
                  width={132}
                  ariaLabel="余额比较方式"
                />
                <div className="filter-input">
                  <input
                    inputMode="decimal"
                    placeholder="请输入"
                    value={draft.balanceValue}
                    onChange={(event) => setDraft({ ...draft, balanceValue: event.target.value.replace(/[^\d.]/g, "") })}
                    aria-label="余额金额"
                  />
                  <span className="unit">元</span>
                </div>
              </div>
            </div>
          )}
          <p className="filter-hint">
            提示：筛选条件只作用于当前列表，KPI 概览仍按全部有权限账户统计。
          </p>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Date range popover                                                 */
/* ------------------------------------------------------------------ */

export function DateRangePopover({
  range,
  onApply,
  onClose,
}: {
  range: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);

  const applyCustom = () => {
    if (!start || !end) return;
    const a = start <= end ? start : end;
    const b = start <= end ? end : start;
    onApply({ start: a, end: b });
  };

  return (
    <>
      <div className="click-catcher" onClick={onClose} />
      <div className="popover date-pop">
        <div className="date-presets">
          {[
            { key: "today", label: "今日" },
            { key: "yesterday", label: "昨日" },
            { key: "last7", label: "近 7 天" },
            { key: "last30", label: "近 30 天" },
          ].map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={range.preset === preset.key ? "is-active" : ""}
              onClick={() => onApply(presetRange(preset.key))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="date-custom">
          <input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} aria-label="开始日期" />
          <span>~</span>
          <input type="date" value={end} min={start} max={toDateKey(TODAY)} onChange={(event) => setEnd(event.target.value)} aria-label="结束日期" />
        </div>
        <div className="date-granularity">最小粒度：按天（当前数据为日级）</div>
        <div className="date-footer">
          <button type="button" className="btn btn-default btn-sm" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={applyCustom}>
            确定
          </button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* KPI fullscreen                                                     */
/* ------------------------------------------------------------------ */

export interface KpiItem {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  format: (value: number | null) => string;
  unit?: string;
  spark: number[];
  hint?: string;
}

export function KpiModal({
  open,
  onClose,
  title,
  kpis,
  labels,
  channel,
  totalsSeries,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  kpis: KpiItem[];
  labels: string[];
  channel: Channel;
  totalsSeries: { date: string; totals: Totals }[];
}) {
  const series =
    channel === "auction"
      ? [
          { name: "整体消耗", color: "#2b6bff", values: totalsSeries.map((item) => item.totals.cost), area: true },
          { name: "支付金额", color: "#6f5cf5", values: totalsSeries.map((item) => item.totals.revenue) },
        ]
      : [
          { name: "消耗", color: "#2b6bff", values: totalsSeries.map((item) => item.totals.cost), area: true },
          { name: "展示次数", color: "#00b42a", values: totalsSeries.map((item) => item.totals.show) },
        ];

  return (
    <Modal open={open} onClose={onClose} title={title} desc="全屏视图用于复盘与汇报；指标展示可在看板右上角「指标配置」中调整" className="kpi-fullscreen">
      <div className="kpi-full-grid">
        {kpis.map((item) => {
          const ratio = item.value !== null && item.prev !== null && item.prev !== 0 ? ((item.value - item.prev) / item.prev) * 100 : null;
          return (
            <div className="kpi-big" key={item.key}>
              <div className="label">
                {item.label} {item.hint && <span className="muted">· {item.hint}</span>}
              </div>
              <div className="value">
                <b>{item.format(item.value)}</b>
                {item.unit && <span className="muted">{item.unit}</span>}
                <span style={{ marginLeft: "auto" }}>
                  <Sparkline values={item.spark.length > 1 ? item.spark : [0, 0]} color="#9ab7ff" width={72} height={24} />
                </span>
              </div>
              <div className="compare">
                {ratio === null ? "无对比数据" : `较上周期 ${ratio >= 0 ? "+" : ""}${ratio.toFixed(1)}%`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="kpi-chart">
        <div className="hstack gap-12" style={{ padding: "0 2px 6px" }}>
          <span className="drawer-section-title" style={{ margin: 0 }}>
            趋势明细
          </span>
          <div className="chart-legend">
            {series.map((item) => (
              <span key={item.name}>
                <i style={{ background: item.color }} />
                {item.name}
              </span>
            ))}
          </div>
        </div>
        <TrendChart
          labels={labels.map((label) => label.slice(5))}
          series={series}
          height={220}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer                                                      */
/* ------------------------------------------------------------------ */

function lastDays(range: DateRange, count: number): string[] {
  const end = parseDateKey(range.end);
  return Array.from({ length: count }, (_, index) => toDateKey(addDays(end, index - (count - 1))));
}

const PRODUCT_STATUS_CLASS: Record<string, string> = {
  在售: "onsale",
  售罄: "soldout",
  审核中: "review",
  已下架: "off",
};

const PRODUCT_CATEGORIES = ["美妆个护", "食品饮料", "数码潮玩", "户外运动", "家居家纺", "服饰生活", "本地生活", "其他"];
const PRODUCT_STATUSES: ProductStatus[] = ["在售", "售罄", "审核中", "已下架"];

function ProductEditorModal({
  open,
  account,
  product,
  hasPlans,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  account: Account | null;
  product: Product | null;
  hasPlans: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [stock, setStock] = useState("0");
  const [category, setCategory] = useState("其他");
  const [status, setStatus] = useState<ProductStatus>("在售");
  const [emoji, setEmoji] = useState("📦");

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? "");
    setPrice(String(product?.price ?? 0));
    setStock(String(product?.stock ?? 0));
    setCategory(product?.category ?? "其他");
    setStatus(product?.status ?? "在售");
    setEmoji(product?.emoji ?? "📦");
  }, [open, product?.id]);

  if (!account) return null;

  const valid = name.trim().length > 0 && Number(price) >= 0 && Number(stock) >= 0;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: product?.id ?? `prod_custom_${account.id}_${Date.now()}`,
      accountId: account.id,
      channel: account.channel,
      name: name.trim(),
      price: Number(price) || 0,
      stock: Math.round(Number(stock) || 0),
      category,
      status,
      emoji: emoji.trim() || "📦",
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? "编辑商品" : "新建商品"}
      desc={`${account.name} · 商品上下架与推广计划独立管理`}
      className="product-modal"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>取消</button>
          <span className="spacer" />
          {product && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={hasPlans}
              title={hasPlans ? "该商品仍有推广计划，不能删除" : "删除商品"}
              onClick={() => onDelete(product)}
            >
              删除商品
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!valid} onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <div className="product-form">
        <label className="pt-field-label" htmlFor="product-name">商品名称</label>
        <input
          id="product-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：玻尿酸保湿精华"
        />
        <div className="product-form-grid">
          <div>
            <label className="pt-field-label" htmlFor="product-price">价格（元）</label>
            <input id="product-price" type="number" min={0} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
          </div>
          <div>
            <label className="pt-field-label" htmlFor="product-stock">库存</label>
            <input id="product-stock" type="number" min={0} step="1" value={stock} onChange={(event) => setStock(event.target.value)} />
          </div>
          <div>
            <label className="pt-field-label" htmlFor="product-category">类目</label>
            <select id="product-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              {PRODUCT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="pt-field-label" htmlFor="product-status">状态</label>
            <select id="product-status" value={status} onChange={(event) => setStatus(event.target.value as ProductStatus)}>
              {PRODUCT_STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label className="pt-field-label" htmlFor="product-emoji">图标</label>
            <input id="product-emoji" value={emoji} maxLength={4} onChange={(event) => setEmoji(event.target.value)} />
          </div>
        </div>
        {product && hasPlans && (
          <p className="drawer-hint">该商品仍被推广计划引用，删除前需先处理相关计划；可以先改为「售罄 / 已下架」。</p>
        )}
        {product && status !== "在售" && hasPlans && (
          <p className="drawer-hint">注意：改为「{status}」后，关联计划仍存在；建议同步暂停计划或调整投放。</p>
        )}
      </div>
    </Modal>
  );
}

export function DetailDrawer({
  target,
  campaigns,
  products,
  resolveProduct,
  range,
  onRangeChange,
  onClose,
  onToggleCampaign,
  onOpenAccount,
  onAskGetMore,
  onSaveProduct,
  onDeleteProduct,
}: {
  target: { kind: "account"; account: Account } | { kind: "campaign"; campaign: Campaign; account: Account } | null;
  campaigns: Campaign[];
  products: Product[];
  resolveProduct: (id: string) => Product | undefined;
  range: DateRange;
  onRangeChange?: (range: DateRange) => void;
  onClose: () => void;
  onToggleCampaign: (campaign: Campaign, next: boolean) => void;
  onOpenAccount: (account: Account) => void;
  onAskGetMore?: (scope: { accountId: string; accountName: string; planId?: string; planName?: string; productId?: string; productName?: string }) => void;
  onSaveProduct: (product: Product) => void;
  onDeleteProduct: (product: Product) => void;
}) {
  const open = Boolean(target);
  const [rangeOpen, setRangeOpen] = useState(false);

  const account = target?.kind === "account" ? target.account : target?.kind === "campaign" ? target.account : null;
  const campaign = target?.kind === "campaign" ? target.campaign : null;
  const { productThreads, requestProductThread, openProductThread } = useWorkbench();
  const threadByProduct = useMemo(
    () => new Map(productThreads.map((thread) => [thread.productId, thread])),
    [productThreads],
  );
  const [productEditor, setProductEditor] = useState<{ product: Product | null } | null>(null);

  useEffect(() => {
    setProductEditor(null);
  }, [account?.id]);

  const productHasPlans = (productId: string) => campaigns.some((item) => item.productId === productId);

  const labels = useMemo(() => lastDays(range, 14), [range]);
  const totals = useMemo(() => {
    if (!target) return null;
    const series = target.kind === "account" ? target.account.daily : target.campaign.daily;
    return sumSeries(series, range);
  }, [target, range]);

  const daily = useMemo(() => {
    if (!target) return [];
    const series = target.kind === "account" ? target.account.daily : target.campaign.daily;
    return labels.map((date) => {
      const point = series.find((item) => item.date === date);
      return { date, totals: point ?? { date, cost: 0, orders: 0, revenue: 0, show: 0, click: 0 } };
    });
  }, [target, labels]);

  const relatedCampaigns = useMemo(() => {
    if (!account) return [];
    return campaigns.filter((item) => item.accountId === account.id).slice(0, 5);
  }, [account, campaigns]);

  const productGroups = useMemo(() => {
    if (!account) return [];
    const groups = new Map<
      string,
      { product: Product; plans: number; cost: number; revenue: number }
    >();
    for (const product of products.filter((item) => item.accountId === account.id)) {
      groups.set(product.id, { product, plans: 0, cost: 0, revenue: 0 });
    }
    for (const item of campaigns.filter((campaignItem) => campaignItem.accountId === account.id)) {
      const product = resolveProduct(item.productId);
      if (!product) continue;
      const totals = sumSeries(item.daily, range);
      const group = groups.get(product.id) ?? {
        product,
        plans: 0,
        cost: 0,
        revenue: 0,
      };
      group.plans += 1;
      group.cost += totals.cost;
      group.revenue += totals.revenue;
      groups.set(product.id, group);
    }
    const statusOrder = { 在售: 0, 售罄: 1, 审核中: 2, 已下架: 3 } as const;
    return Array.from(groups.values()).sort(
      (a, b) => statusOrder[a.product.status] - statusOrder[b.product.status] || b.cost - a.cost,
    );
  }, [account, campaigns, products, resolveProduct, range]);

  const title = campaign?.name ?? account?.name ?? "";
  const campaignProduct = campaign ? resolveProduct(campaign.productId) : null;
  const productOfCampaign = (item: Campaign) => resolveProduct(item.productId);
  const accountHealth = account ? dataHealthOf(account) : null;
  const accountNet = account
    ? netTotalsOf(account.daily.filter((point) => point.date >= range.start && point.date <= range.end))
    : null;
  const campaignNet = campaign
    ? netTotalsOf(campaign.daily.filter((point) => point.date >= range.start && point.date <= range.end))
    : null;
  const campaignCreatives = campaign ? campaign.creativeIds.map((id) => creativeById(id)).filter(Boolean) : [];
  const forecast = campaign ? forecastPlan(campaign, range) : null;
  const sub = campaign
    ? `${campaign.mode} · ${campaign.target}${campaign.brandPlacement ? ` · ${campaign.brandPlacement}` : ""} · ID: ${campaign.id}`
    : account
      ? `${orgName(account.orgId)} · ID: ${account.id}`
      : "";

  return (
    <>
      <Drawer
        open={open}
      onClose={onClose}
      title={
        <span className="hstack gap-8">
          {title}
          {account && <StatusBadge status={account.status} />}
        </span>
      }
      sub={sub}
    >
      {account && onRangeChange && (
        <div className="drawer-range">
          <button
            type="button"
            className={`date-range ${rangeOpen ? "is-open" : ""}`}
            onClick={() => setRangeOpen((value) => !value)}
          >
            <CalendarDays size={14} className="cal" />
            <span>{range.start} ~ {range.end}</span>
          </button>
          <span className="drawer-range-hint">统计周期，可按天筛选</span>
          {rangeOpen && (
            <DateRangePopover
              range={range}
              onClose={() => setRangeOpen(false)}
              onApply={(next) => {
                onRangeChange(next);
                setRangeOpen(false);
              }}
            />
          )}
        </div>
      )}
      {account && campaign && onAskGetMore && (
        <div className="pt-data-experiment-callout">
          <div>
            <b>问问大模型怎么规划</b>
            <p>带上当前计划和统计周期，交给 GetMore 团队拆解；工具与技能由模型选择，写动作仍需确认。</p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              onAskGetMore({
                accountId: account.id,
                accountName: account.name,
                planId: campaign.id,
                planName: campaign.name,
                productId: campaignProduct?.id,
                productName: campaignProduct?.name,
              })
            }
          >
            GetMore
          </button>
        </div>
      )}
      {account && !campaign && totals && (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">
              数据概览
              <span className="hint">
                {fmtDateShort(range.start)} ~ {fmtDateShort(range.end)}
              </span>
            </div>
            <div className="detail-grid">
              <div className="detail-stat">
                <div className="label">整体消耗</div>
                <div className="value">{fmtMoney(totals.cost)}</div>
                <div className="delta">账户预算 {fmtMoney(account.budget)} / 日</div>
              </div>
              <div className="detail-stat">
                <div className="label">用户实际支付金额</div>
                <div className="value">{fmtMoney(totals.revenue)}</div>
                <div className="delta">整体支付ROI {fmtRoi(roiOf(totals))}</div>
              </div>
              <div className="detail-stat">
                <div className="label">整体成交订单数</div>
                <div className="value">{fmtInt(totals.orders)}</div>
                <div className="delta">订单成本 {fmtMoney(cpaOf(totals))} 元</div>
              </div>
              <div className="detail-stat">
                <div className="label">总余额</div>
                <div className="value">{fmtMoney(account.balance)}</div>
                <div className="delta">{account.balance < 5000 ? "余额不足，建议尽快充值" : "余额充足"}</div>
              </div>
              <div className="detail-stat">
                <div className="label">展示次数</div>
                <div className="value">{fmtInt(totals.show)}</div>
                <div className="delta">点击率 {fmtPct(ctrOf(totals))}</div>
              </div>
              <div className="detail-stat">
                <div className="label">我的角色</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {account.role}
                </div>
                <div className="delta">{account.remark}</div>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              经营数据与数据健康
              <span className="hint">净成交 / 退款为千川报表口径</span>
            </div>
            <div className="detail-grid">
              <div className="detail-stat">
                <div className="label">净成交金额</div>
                <div className="value">{accountNet?.netRevenue == null ? "--" : fmtMoney(accountNet.netRevenue)}</div>
                <div className="delta">
                  {accountNet?.netRevenue == null
                    ? "未同步，需要商品/交易授权"
                    : `净成交ROI ${fmtRoi(totals.cost > 0 ? accountNet.netRevenue / totals.cost : null)}`}
                </div>
              </div>
              <div className="detail-stat">
                <div className="label">退款金额 / 退款率</div>
                <div className="value">{accountNet?.refundAmount == null ? "--" : fmtMoney(accountNet.refundAmount)}</div>
                <div className="delta">
                  {accountNet?.refundRate == null ? "退款数据未同步" : `1小时退款率 ${(accountNet.refundRate * 100).toFixed(1)}%`}
                </div>
              </div>
              <div className="detail-stat">
                <div className="label">授权 / 数据同步</div>
                <div className="value" style={{ fontSize: 16 }}>{account.authorization}</div>
                <div className="delta">
                  最近同步 {account.lastSyncedAt} · 延迟 {account.dataLagMinutes} 分钟
                </div>
              </div>
              <div className="detail-stat">
                <div className="label">有效余额 / 共享钱包</div>
                <div className="value">
                  {account.effectiveBalance == null ? "--" : fmtMoney(account.effectiveBalance)}
                </div>
                <div className="delta">
                  {account.sharedWalletBalance == null
                    ? "未加入共享钱包 / 无权限"
                    : `共享钱包 ${fmtMoney(account.sharedWalletBalance)}`}
                </div>
              </div>
            </div>
            <p className="drawer-hint">
              {accountHealth?.missing.length ? `数据缺口：${accountHealth.missing.join("、")}。` : "关键字段齐全。"}
              {accountHealth?.stale.length ? ` ${accountHealth.stale.join("；")}。` : ""}
              数据源：{account.dataSources.join(" / ")}；千川报表约 5 分钟刷新，净成交/结算数据可能延迟。
            </p>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              近 14 天趋势
              <div className="chart-legend" style={{ marginLeft: "auto" }}>
                <span>
                  <i style={{ background: "#2b6bff" }} />
                  消耗
                </span>
                <span>
                  <i style={{ background: "#6f5cf5" }} />
                  支付金额
                </span>
              </div>
            </div>
            <div className="drawer-chart-card">
              <TrendChart
                labels={labels.map((label) => label.slice(5))}
                series={[
                  { name: "消耗", color: "#2b6bff", values: daily.map((item) => item.totals.cost), area: true },
                  { name: "支付金额", color: "#6f5cf5", values: daily.map((item) => item.totals.revenue) },
                ]}
                height={200}
              />
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              店铺商品
              <span className="hint">
                共 {productGroups.length} 个 · 在售 {productGroups.filter((group) => group.product.status === "在售").length} · 在投{" "}
                {productGroups.filter((group) => group.plans > 0).length}
              </span>
              <button
                type="button"
                className="btn btn-default btn-sm"
                style={{ marginLeft: "auto" }}
                onClick={() => setProductEditor({ product: null })}
              >
                + 新建商品
              </button>
            </div>
            <div className="product-list">
              {productGroups.map((group) => (
                <div className={`product-row ${group.product.status !== "在售" ? "is-inactive" : ""}`} key={group.product.id}>
                  <span className="product-emoji">{group.product.emoji}</span>
                  <div className="product-main">
                    <div className="product-title-line">
                      <span className="product-name">{group.product.name}</span>
                      <span className={`product-status is-${PRODUCT_STATUS_CLASS[group.product.status]}`}>
                        {group.product.status}
                      </span>
                    </div>
                    <div className="product-meta">
                      ¥{fmtMoney(group.product.price)} · 库存 {fmtInt(group.product.stock)} · {group.plans} 个推广计划
                    </div>
                  </div>
                  <div className="product-metric">
                    <span>消耗</span>
                    <b>{fmtMoney(group.cost)}</b>
                  </div>
                  <div className="product-metric">
                    <span>ROI</span>
                    <b>{fmtRoi(group.cost > 0 ? group.revenue / group.cost : null)}</b>
                  </div>
                  {group.plans > 0 ? (
                    <button
                      type="button"
                      className="btn-link product-assistant"
                      title={
                        threadByProduct.get(group.product.id)
                          ? "打开该商品的智能助手"
                          : "为这个商品建立固定的智能助手"
                      }
                      onClick={() => {
                        const thread = threadByProduct.get(group.product.id);
                        if (thread) openProductThread(thread.id);
                        else requestProductThread(group.product.id);
                      }}
                    >
                      {threadByProduct.get(group.product.id) ? "进入助手" : "创建智能助手"}
                    </button>
                  ) : (
                    <span className="product-no-assistant">暂无投放</span>
                  )}
                  <button
                    type="button"
                    className="btn-link product-edit"
                    onClick={() => setProductEditor({ product: group.product })}
                  >
                    编辑
                  </button>
                </div>
              ))}
            </div>
            <p className="drawer-hint">
              店铺 / 账户 → 店铺商品 → 推广计划。商品是独立实体，有上下架状态；计划是商品的一种投放方式，同一商品可以有多条计划。
            </p>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              该账户的{account.channel === "auction" ? "推广计划" : "品牌预定单"}
              <span className="hint">共 {relatedCampaigns.length} 个 · 每个计划推广一个商品</span>
            </div>
            <div className="plan-list">
              {relatedCampaigns.map((item) => (
                <div className="plan-list-row" key={item.id}>
                  <Switch checked={item.status === "投放中"} onChange={(next) => onToggleCampaign(item, next)} ariaLabel={item.name} />
                  <div className="plan-list-main">
                    <div className="plan-list-name">{item.name}</div>
                    <div className="plan-list-meta">
                      <span className="tag tag-product">
                        {productOfCampaign(item)?.emoji} {productOfCampaign(item)?.name ?? "商品缺失"}
                      </span>
                      <span className="tag tag-outline">{item.mode}</span>
                      <span className="tag tag-outline">{item.target}</span>
                      <span>ID: {item.id}</span>
                    </div>
                  </div>
                  <div className="plan-list-metric">
                    <span className="k">消耗</span>
                    <span className="v">{fmtMoney(sumSeries(item.daily, range).cost)}</span>
                  </div>
                  <div className="plan-list-metric">
                    <span className="k">ROI</span>
                    <span className="v">{fmtRoi(roiOf(sumSeries(item.daily, range)))}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {campaign === null && (
            <p className="ctx-note">
              数据为本地模拟，仅用于演示多账户看板与 Agent 协同；账户详情、计划启停与导出均为真实前端交互。
            </p>
          )}
        </>
      )}

      {campaign && account && totals && (
        <>
          <div className="drawer-section">
            <div className="drawer-section-title">计划概览</div>
            <div className="detail-grid">
              <div className="detail-stat">
                <div className="label">整体消耗</div>
                <div className="value">{fmtMoney(totals.cost)}</div>
                <div className="delta">日预算 {fmtMoney(campaign.budget)}</div>
              </div>
              <div className="detail-stat">
                <div className="label">整体支付ROI</div>
                <div className="value">{fmtRoi(roiOf(totals))}</div>
                <div className="delta">支付金额 {fmtMoney(totals.revenue)}</div>
              </div>
              <div className="detail-stat">
                <div className="label">整体成交订单数</div>
                <div className="value">{fmtInt(totals.orders)}</div>
                <div className="delta">订单成本 {fmtMoney(cpaOf(totals))} 元</div>
              </div>
              <div className="detail-stat">
                <div className="label">展示 / 点击</div>
                <div className="value">{fmtInt(totals.show)}</div>
                <div className="delta">点击率 {fmtPct(ctrOf(totals))}</div>
              </div>
              <div className="detail-stat">
                <div className="label">出价</div>
                <div className="value">{fmtMoney(campaign.bid)}</div>
                <div className="delta">抖音号 {campaign.douyinId}</div>
              </div>
              <div className="detail-stat">
                <div className="label">归属账户</div>
                <div className="value" style={{ fontSize: 15 }}>
                  <button type="button" className="btn-link" onClick={() => onOpenAccount(account)}>
                    {account.name}
                  </button>
                </div>
                <div className="delta">ID: {account.id}</div>
              </div>
              <div className="detail-stat">
                <div className="label">净成交金额</div>
                <div className="value">{campaignNet?.netRevenue == null ? "--" : fmtMoney(campaignNet.netRevenue)}</div>
                <div className="delta">
                  {campaignNet?.netRevenue == null
                    ? "净成交数据未同步"
                    : `净成交ROI ${fmtRoi(totals.cost > 0 ? campaignNet.netRevenue / totals.cost : null)}`}
                </div>
              </div>
              <div className="detail-stat">
                <div className="label">1小时退款率</div>
                <div className="value">
                  {campaignNet?.refundRate == null ? "--" : `${(campaignNet.refundRate * 100).toFixed(1)}%`}
                </div>
                <div className="delta">
                  {campaignNet?.refundAmount == null ? "退款数据未同步" : `退款 ${fmtMoney(campaignNet.refundAmount)}`}
                </div>
              </div>
              <div className="detail-stat">
                <div className="label">ROI 目标 / 学习期</div>
                <div className="value" style={{ fontSize: 16 }}>
                  {campaign.roiGoal == null ? "--" : campaign.roiGoal.toFixed(1)}
                </div>
                <div className="delta">
                  {campaign.learningPhase} · {campaign.bidStrategy}
                </div>
              </div>
            </div>
            {campaign.rejectReason && (
              <p className="drawer-hint">审核拒绝原因：{campaign.rejectReason}</p>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              近 14 天趋势
              <div className="chart-legend" style={{ marginLeft: "auto" }}>
                <span>
                  <i style={{ background: "#2b6bff" }} />
                  消耗
                </span>
                <span>
                  <i style={{ background: "#6f5cf5" }} />
                  支付金额
                </span>
              </div>
            </div>
            <div className="drawer-chart-card">
              <TrendChart
                labels={labels.map((label) => label.slice(5))}
                series={[
                  { name: "消耗", color: "#2b6bff", values: daily.map((item) => item.totals.cost), area: true },
                  { name: "支付金额", color: "#6f5cf5", values: daily.map((item) => item.totals.revenue) },
                ]}
                height={200}
              />
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">商品与投放设置</div>
            <div className="plan-list">
              <div className="plan-list-row">
                <span className="prod-thumb" aria-hidden="true">
                  {campaignProduct?.emoji ?? "📦"}
                </span>
                <div className="plan-list-main">
                  <div className="plan-list-name">{campaignProduct?.name ?? "商品缺失"}</div>
                  <div className="plan-list-meta">
                    <span>商品价格 ¥{fmtMoney(campaignProduct?.price ?? 0)}</span>
                    <span className="dot-sep">·</span>
                    <span>库存 {fmtInt(campaignProduct?.stock ?? 0)}</span>
                    <span className="dot-sep">·</span>
                    <span>投放方式 {campaign.mode}</span>
                  </div>
                </div>
                <div className="plan-list-metric">
                  <span className="k">出价</span>
                  <span className="v">{fmtMoney(campaign.bid)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">投放设置</div>
            <div className="info-grid">
              <div><span>投放方式</span><b>{campaign.mode}</b></div>
              <div><span>推广目标</span><b>{campaign.target}</b></div>
              {campaign.brandPlacement && <div><span>投放位置</span><b>{campaign.brandPlacement}</b></div>}
              <div><span>出价策略</span><b>{campaign.bidStrategy}</b></div>
              <div><span>ROI 目标</span><b>{campaign.roiGoal == null ? "未设置" : campaign.roiGoal.toFixed(1)}</b></div>
              <div><span>投放时段</span><b>{campaign.scheduleType} · {campaign.schedule}</b></div>
              <div><span>学习期</span><b>{campaign.learningPhase}</b></div>
              <div><span>人群</span><b>{campaign.audience.gender} · {campaign.audience.age} · {campaign.audience.regions.join("/")}</b></div>
              <div><span>兴趣</span><b>{campaign.audience.interests.join(" / ")}</b></div>
              <div><span>落地页</span><b>{campaign.landingPage}</b></div>
              <div><span>抖音号</span><b>{campaign.douyinId}</b></div>
            </div>
          </div>

          {forecast && campaign.channel === "auction" && (
            <div className="drawer-section">
              <div className="drawer-section-title">
                未来 {forecast.horizonDays} 天判断
                <span className="hint">基于近 7 天走势与素材结构</span>
              </div>
              <div className="forecast-head">
                <span className={`forecast-action ${forecast.recommendation.action}`}>{forecast.recommendation.label}</span>
                <b>
                  ROI {fmtRoi(forecast.range.roiLow)}–{fmtRoi(forecast.range.roiHigh)}
                </b>
                <span className="forecast-confidence">
                  置信度 {{ high: "高", medium: "中", low: "低" }[forecast.confidence]}
                </span>
              </div>
              <p className="drawer-hint">{forecast.recommendation.reason}</p>
              <div className="forecast-grid">
                <div>
                  <span>预测成交</span>
                  <b>¥{fmtMoney(forecast.range.revenueLow, 0)}–{fmtMoney(forecast.range.revenueHigh, 0)}</b>
                </div>
                <div>
                  <span>预测 ROI</span>
                  <b>{fmtRoi(forecast.baseline.roi)}{forecast.baseline.netRoi == null ? "" : ` / 净 ${fmtRoi(forecast.baseline.netRoi)}`}</b>
                </div>
                <div>
                  <span>走势</span>
                  <b>
                    {forecast.trend.direction === "up" ? "转好" : forecast.trend.direction === "down" ? "转差" : "持平"}
                    {forecast.trend.roiChangePct == null ? "" : ` ${forecast.trend.roiChangePct > 0 ? "+" : ""}${forecast.trend.roiChangePct.toFixed(1)}%`}
                  </b>
                </div>
              </div>
              <div className="forecast-scenarios">
                {forecast.scenarios.map((scenario) => (
                  <span key={scenario.key}>
                    {scenario.label} {scenario.roi == null ? "--" : scenario.roi.toFixed(2)}
                  </span>
                ))}
              </div>
              <p className="drawer-hint">验证点：{forecast.recommendation.checkpoints.join("；")}</p>
              <p className="drawer-hint">回滚：{forecast.recommendation.rollback}</p>
            </div>
          )}

          <div className="drawer-section">
            <div className="drawer-section-title">
              素材与审核
              <span className="hint">千川创意报表口径</span>
            </div>
            {campaignCreatives.length === 0 ? (
              <p className="drawer-hint">素材明细未同步；需要素材授权。</p>
            ) : (
              <div className="creative-list">
                {campaignCreatives.map((creative) => {
                  if (!creative) return null;
                  const metrics = creativeMetrics(creative, range);
                  return (
                    <div className="creative-row" key={creative.id}>
                      <span className="creative-type">{creative.type}</span>
                      <div className="creative-main">
                        <b>{creative.title}</b>
                        <span>{creative.id} · {creative.hook}</span>
                        <span>
                          {campaign.channel === "brand"
                            ? `消耗 ${fmtMoney(metrics.cost)} · 展示 ${fmtInt(metrics.show)} · 点击 ${fmtInt(metrics.click)} · CTR ${fmtPct(metrics.ctr)}`
                            : `消耗 ${fmtMoney(metrics.cost)} · ROI ${fmtRoi(metrics.roi)}${metrics.netRoi == null ? "" : ` · 净ROI ${fmtRoi(metrics.netRoi)}`} · CTR ${fmtPct(metrics.ctr)} · CVR ${fmtPct(metrics.cvr)}${
                                metrics.completion5s == null ? "" : ` · 5s完播 ${fmtPct(metrics.completion5s * 100)}`
                              }${metrics.refundRate == null ? "" : ` · 退款率 ${fmtPct(metrics.refundRate)}`}`}
                        </span>
                      </div>
                      <span className={`creative-audit ${creative.auditStatus === "通过" ? "ok" : creative.auditStatus === "拒绝" ? "bad" : "pending"}`}>
                        {creative.auditStatus}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {campaignCreatives.some((creative) => creative?.rejectReason) && (
              <p className="drawer-hint">
                拒绝原因：{campaignCreatives.find((creative) => creative?.rejectReason)?.rejectReason}
              </p>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">
              最近调整
              <span className="hint">来自千川调整记录</span>
            </div>
            {campaign.changes.length === 0 ? (
              <p className="drawer-hint">暂无调整记录。</p>
            ) : (
              <div className="change-list">
                {campaign.changes.slice(0, 5).map((change) => (
                  <div className="change-row" key={change.id}>
                    <span className="change-field">{change.field}</span>
                    <div className="change-main">
                      <b>{change.before} → {change.after}</b>
                      <span>{change.at} · {change.actor} · {change.reason}</span>
                    </div>
                    <span className={change.result === "成功" ? "change-ok" : "change-bad"}>{change.result}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      </Drawer>
      {account && (
        <ProductEditorModal
          open={Boolean(productEditor)}
          account={account}
          product={productEditor?.product ?? null}
          hasPlans={productEditor?.product ? productHasPlans(productEditor.product.id) : false}
          onClose={() => setProductEditor(null)}
          onSave={(product) => {
            onSaveProduct(product);
            setProductEditor(null);
          }}
          onDelete={(product) => {
            onDeleteProduct(product);
            setProductEditor(null);
          }}
        />
      )}
    </>
  );
}

