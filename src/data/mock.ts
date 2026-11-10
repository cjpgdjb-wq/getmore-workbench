/**
 * GETmore 工作台 · 模拟数据层
 *
 * 数据全部在浏览器本地确定性生成（同一账户/日期结果稳定），
 * 用于演示多账户投放看板：组织 → 账户 → 推广(计划) 三级下钻。
 * 不连接任何真实广告平台。
 */

export type Channel = "auction" | "brand";
export type Dimension = "org" | "account" | "campaign";
export type AuctionMode = "全域推广" | "标准推广";
export type Target = "全部" | "推商品" | "推直播间";
export type BrandScope = "整体（不含搜索）" | "搜索";

export type AccountStatus = "投放中" | "已暂停" | "余额不足" | "审核中" | "已结束";
export type CampaignStatus = "投放中" | "已暂停" | "审核中" | "已结束";
export type ProductStatus = "在售" | "售罄" | "审核中" | "已下架";
export type AuthorizationStatus = "已授权" | "部分授权" | "未授权";
export type DataSource = "千川报表" | "商品交易" | "素材";

export interface DailyPoint {
  date: string;
  cost: number;
  orders: number;
  revenue: number;
  show: number;
  click: number;
  /** 净成交金额：依赖商品/交易数据授权；未授权时为 null */
  netRevenue?: number | null;
  /** 净成交订单数：依赖商品/交易数据授权 */
  netOrders?: number | null;
  refundAmount?: number | null;
  /** 1 小时退款率，千川报表口径 */
  refundRate?: number | null;
}

/** 素材日数据：在计划日数据基础上增加 5 秒完播率 */
export interface CreativeDaily extends DailyPoint {
  /** 5 秒完播率（0-1）；图片素材为 null */
  completion5s: number | null;
}

export interface NetTotals {
  netRevenue: number | null;
  netOrders: number | null;
  refundAmount: number | null;
  refundRate: number | null;
}

export interface Totals {
  cost: number;
  orders: number;
  revenue: number;
  show: number;
  click: number;
}

export interface Org {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  children: string[];
  channel: Channel;
}

export interface Account {
  id: string;
  name: string;
  short: string;
  orgId: string;
  channel: Channel;
  status: AccountStatus;
  role: "管理员" | "优化师" | "观察者";
  followed: boolean;
  budget: number;
  balance: number;
  remark: string;
  authorization: AuthorizationStatus;
  dataSources: DataSource[];
  /** 最近一次数据同步时间；真实千川报表通常 5 分钟刷新一次 */
  lastSyncedAt: string;
  dataLagMinutes: number;
  /** 账户有效余额：部分账户无权限时为 null */
  effectiveBalance: number | null;
  /** 共享钱包余额：仅加入共享钱包的账户有值 */
  sharedWalletBalance: number | null;
  color: [string, string];
  daily: DailyPoint[];
}

export interface Product {
  id: string;
  accountId: string;
  channel: Channel;
  name: string;
  price: number;
  emoji: string;
  category: string;
  status: ProductStatus;
  stock: number;
}

export interface Audience {
  gender: "不限" | "男" | "女";
  age: string;
  regions: string[];
  interests: string[];
}

export interface ChangeEvent {
  id: string;
  accountId: string;
  campaignId?: string;
  field: string;
  before: string;
  after: string;
  actor: string;
  actorType: "human" | "agent" | "system";
  source: "千川后台" | "Agent" | "系统";
  at: string;
  reason: string;
  result: "成功" | "失败";
}

export type CreativeHook =
  | "真实测评"
  | "场景种草"
  | "低价钩子"
  | "参数罗列"
  | "直播切片"
  | "达人同款";

export interface Creative {
  id: string;
  accountId: string;
  campaignId: string;
  type: "短视频" | "图片" | "直播间";
  hook: CreativeHook;
  title: string;
  durationSeconds: number;
  auditStatus: "审核中" | "通过" | "拒绝";
  rejectReason: string | null;
  createdAt: string;
  /** 素材日数据；未过审/未投放的日期为 0 */
  daily: CreativeDaily[];
}

export interface Campaign {
  id: string;
  name: string;
  accountId: string;
  channel: Channel;
  mode: AuctionMode | "品牌预定单";
  target: Exclude<Target, "全部">;
  /** 品牌渠道下的投放位置：信息流 / 搜索 */
  brandPlacement?: "品牌信息流" | "品牌搜索";
  status: CampaignStatus;
  budget: number;
  bid: number;
  bidStrategy: "控成本投放" | "放量投放";
  roiGoal: number | null;
  optimizationGoal: string;
  scheduleType: "全天" | "指定时段";
  schedule: string;
  audience: Audience;
  creativeIds: string[];
  landingPage: string;
  liveRoomId?: string;
  liveRoomTitle?: string;
  learningPhase: "学习中" | "已成长期" | "未进入";
  /** 进入学习期的时间；未进入/已成长期为 null */
  learningStartedAt: string | null;
  /** 已在学习期内的天数；0 表示未进入或已过学习期 */
  learningDays: number;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  changes: ChangeEvent[];
  douyinId: string;
  productId: string;
  daily: DailyPoint[];
}

export interface DataHealth {
  accountId: string;
  completeness: number;
  authorization: AuthorizationStatus;
  lastSyncedAt: string;
  lagMinutes: number;
  missing: string[];
  stale: string[];
}

/* ------------------------------------------------------------------ */
/* Deterministic pseudo random                                        */
/* ------------------------------------------------------------------ */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(key: string, index: number): number {
  return mulberry32(hash(`${key}#${index}`))();
}

function randRange(key: string, index: number, min: number, max: number): number {
  return min + rand(key, index) * (max - min);
}

function pick<T>(key: string, index: number, list: readonly T[]): T {
  return list[Math.floor(rand(key, index) * list.length) % list.length];
}

/* ------------------------------------------------------------------ */
/* Date helpers                                                       */
/* ------------------------------------------------------------------ */

export const HISTORY_DAYS = 120;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export const TODAY = startOfDay(
  typeof globalThis === "object" && (globalThis as { __MOCK_TODAY__?: string }).__MOCK_TODAY__
    ? new Date(`${(globalThis as { __MOCK_TODAY__?: string }).__MOCK_TODAY__}T00:00:00`)
    : new Date(),
);

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export const DATE_KEYS: string[] = Array.from({ length: HISTORY_DAYS }, (_, i) =>
  toDateKey(addDays(TODAY, i - (HISTORY_DAYS - 1))),
);

const DAY_INDEX = new Map(DATE_KEYS.map((key, index) => [key, index]));

export function dayIndexOf(key: string): number {
  const exact = DAY_INDEX.get(key);
  if (exact !== undefined) return exact;
  // 超出生成范围时退化为最近边界
  return key < DATE_KEYS[0] ? 0 : HISTORY_DAYS - 1;
}

export interface DateRange {
  start: string;
  end: string;
  preset?: string;
}

export function makeRange(start: Date, end: Date, preset?: string): DateRange {
  const a = startOfDay(start);
  const b = startOfDay(end);
  return a <= b
    ? { start: toDateKey(a), end: toDateKey(b), preset }
    : { start: toDateKey(b), end: toDateKey(a), preset };
}

export const RANGE_PRESETS = [
  { key: "today", label: "今日" },
  { key: "yesterday", label: "昨日" },
  { key: "last7", label: "近 7 天" },
  { key: "last30", label: "近 30 天" },
] as const;

export function presetRange(key: string): DateRange {
  switch (key) {
    case "today":
      return makeRange(TODAY, TODAY, key);
    case "yesterday": {
      const d = addDays(TODAY, -1);
      return makeRange(d, d, key);
    }
    case "last7":
      return makeRange(addDays(TODAY, -6), TODAY, key);
    case "last30":
      return makeRange(addDays(TODAY, -29), TODAY, key);
    default:
      return makeRange(addDays(TODAY, -6), TODAY, "last7");
  }
}

/** 同长度的上一周期，用于环比 */
export function previousRange(range: DateRange): DateRange {
  const start = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  const span = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return makeRange(addDays(start, -span), addDays(start, -1));
}

export function rangeLength(range: DateRange): number {
  return (
    Math.round(
      (parseDateKey(range.end).getTime() - parseDateKey(range.start).getTime()) /
        86400000,
    ) + 1
  );
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                        */
/* ------------------------------------------------------------------ */

export const EMPTY_TOTALS: Totals = { cost: 0, orders: 0, revenue: 0, show: 0, click: 0 };

export function inRange(point: DailyPoint, range: DateRange): boolean {
  return point.date >= range.start && point.date <= range.end;
}

export function sumSeries(series: DailyPoint[], range: DateRange): Totals {
  const totals: Totals = { ...EMPTY_TOTALS };
  for (const point of series) {
    if (!inRange(point, range)) continue;
    totals.cost += point.cost;
    totals.orders += point.orders;
    totals.revenue += point.revenue;
    totals.show += point.show;
    totals.click += point.click;
  }
  return totals;
}

export function addTotals(list: Totals[]): Totals {
  return list.reduce<Totals>(
    (acc, item) => ({
      cost: acc.cost + item.cost,
      orders: acc.orders + item.orders,
      revenue: acc.revenue + item.revenue,
      show: acc.show + item.show,
      click: acc.click + item.click,
    }),
    { ...EMPTY_TOTALS },
  );
}

export function roiOf(totals: Totals): number | null {
  return totals.cost > 0 ? totals.revenue / totals.cost : null;
}

export function cpaOf(totals: Totals): number | null {
  return totals.orders > 0 ? totals.cost / totals.orders : null;
}

export function ctrOf(totals: Totals): number | null {
  return totals.show > 0 ? (totals.click / totals.show) * 100 : null;
}

export function cpmOf(totals: Totals): number | null {
  return totals.show > 0 ? (totals.cost / totals.show) * 1000 : null;
}

export function dailyTotals(seriesList: DailyPoint[][], range: DateRange): { date: string; totals: Totals }[] {
  const days: string[] = [];
  const cursor = parseDateKey(range.start);
  const end = parseDateKey(range.end);
  while (cursor <= end) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const byDate = new Map<string, Totals>();
  for (const day of days) byDate.set(day, { ...EMPTY_TOTALS });
  for (const series of seriesList) {
    for (const point of series) {
      if (!inRange(point, range)) continue;
      const bucket = byDate.get(point.date);
      if (!bucket) continue;
      bucket.cost += point.cost;
      bucket.orders += point.orders;
      bucket.revenue += point.revenue;
      bucket.show += point.show;
      bucket.click += point.click;
    }
  }
  return days.map((date) => ({ date, totals: byDate.get(date) ?? { ...EMPTY_TOTALS } }));
}

/* ------------------------------------------------------------------ */
/* Organizations                                                      */
/* ------------------------------------------------------------------ */

export const ORGS: Org[] = [
  { id: "710000000000000001", name: "A 公司（服务商）", parentId: null, level: 0, children: ["712000000000000001", "712000000000000002", "712000000000000003"], channel: "auction" },
  { id: "712000000000000001", name: "华东事业群", parentId: "710000000000000001", level: 1, children: ["712000000000000011", "712000000000000012", "712000000000000013"], channel: "auction" },
  { id: "712000000000000002", name: "华南事业群", parentId: "710000000000000001", level: 1, children: ["712000000000000021", "712000000000000022"], channel: "auction" },
  { id: "712000000000000003", name: "品牌营销中心", parentId: "710000000000000001", level: 1, children: ["712000000000000031", "712000000000000032"], channel: "brand" },
  { id: "712000000000000011", name: "华东 · 服饰生活组", parentId: "712000000000000001", level: 2, children: [], channel: "auction" },
  { id: "712000000000000012", name: "华东 · 美妆个护组", parentId: "712000000000000001", level: 2, children: [], channel: "auction" },
  { id: "712000000000000013", name: "华东 · 食品饮料组", parentId: "712000000000000001", level: 2, children: [], channel: "auction" },
  { id: "712000000000000021", name: "华南 · 数码家电组", parentId: "712000000000000002", level: 2, children: [], channel: "auction" },
  { id: "712000000000000022", name: "华南 · 本地生活组", parentId: "712000000000000002", level: 2, children: [], channel: "auction" },
  { id: "712000000000000031", name: "品牌投放一部", parentId: "712000000000000003", level: 2, children: [], channel: "brand" },
  { id: "712000000000000032", name: "品牌投放二部", parentId: "712000000000000003", level: 2, children: [], channel: "brand" },
];

export const ROOT_ORG_ID = "710000000000000001";

export function orgById(id: string): Org | undefined {
  return ORGS.find((org) => org.id === id);
}

export function orgName(id: string): string {
  return orgById(id)?.name ?? "未分配组织";
}

export function descenders(orgId: string, includeSelf = true): string[] {
  const result: string[] = includeSelf ? [orgId] : [];
  const org = orgById(orgId);
  if (!org) return result;
  for (const childId of org.children) {
    result.push(...descenders(childId, true));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                           */
/* ------------------------------------------------------------------ */

const DATA_SYNC_BASE = new Date("2026-11-02T19:00:00+08:00");

function syncedAt(lagMinutes: number): string {
  const date = new Date(DATA_SYNC_BASE.getTime() - lagMinutes * 60_000);
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function authorizationFor(index: number): AuthorizationStatus {
  return index % 13 === 0 ? "部分授权" : "已授权";
}

function dataSourcesFor(index: number, authorization: AuthorizationStatus): DataSource[] {
  const sources: DataSource[] = ["千川报表"];
  if (authorization === "已授权" && index % 4 !== 0) sources.push("商品交易");
  if (index % 5 !== 0) sources.push("素材");
  return sources;
}

function netAvailability(daily: DailyPoint[], sources: DataSource[]): DailyPoint[] {
  if (sources.includes("商品交易")) return daily;
  return daily.map((point) => ({
    ...point,
    netRevenue: null,
    netOrders: null,
    refundAmount: null,
    refundRate: null,
  }));
}

function toLocalTime(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

const AUCTION_BLUEPRINT: {
  name: string;
  short: string;
  orgId: string;
  status: AccountStatus;
  role: Account["role"];
  followed: boolean;
  remark: string;
  budget: number;
  scale: number;
  roiBase: number;
  aov: number;
  color: [string, string];
}[] = [
  { name: "花间集旗舰店", short: "花间", orgId: "712000000000000011", status: "投放中", role: "管理员", followed: true, remark: "服饰主推，日销稳定", budget: 12000, scale: 6800, roiBase: 3.6, aov: 268, color: ["#ff9a8b", "#ff6a88"] },
  { name: "花间集轻奢线", short: "轻奢", orgId: "712000000000000011", status: "投放中", role: "优化师", followed: false, remark: "客单价高，测素材中", budget: 6000, scale: 3200, roiBase: 2.9, aov: 468, color: ["#f6d365", "#fda085"] },
  { name: "拾光服饰旗舰店", short: "拾光", orgId: "712000000000000011", status: "投放中", role: "管理员", followed: true, remark: "女装直播主力账户", budget: 15000, scale: 9200, roiBase: 4.2, aov: 219, color: ["#a18cd1", "#fbc2eb"] },
  { name: "拾光女装直播号", short: "直播", orgId: "712000000000000011", status: "余额不足", role: "优化师", followed: false, remark: "余额预警，待充值", budget: 8000, scale: 2400, roiBase: 3.1, aov: 199, color: ["#84fab0", "#8fd3f4"] },
  { name: "轻氧家居旗舰店", short: "轻氧", orgId: "712000000000000011", status: "投放中", role: "优化师", followed: true, remark: "家纺类目重点账户", budget: 10000, scale: 5600, roiBase: 3.4, aov: 329, color: ["#a1c4fd", "#c2e9fb"] },
  { name: "禾颂家居旗舰店", short: "禾颂", orgId: "712000000000000011", status: "已暂停", role: "观察者", followed: false, remark: "暂停待优化素材", budget: 3000, scale: 800, roiBase: 2.2, aov: 289, color: ["#ffecd2", "#fcb69f"] },
  { name: "初见美妆旗舰店", short: "初见", orgId: "712000000000000012", status: "投放中", role: "管理员", followed: true, remark: "美妆主账户，ROI 稳定", budget: 20000, scale: 12800, roiBase: 4.6, aov: 159, color: ["#ff9a9e", "#fecfef"] },
  { name: "初见护肤专营店", short: "护肤", orgId: "712000000000000012", status: "投放中", role: "优化师", followed: false, remark: "新客拉新，成本略高", budget: 8000, scale: 4100, roiBase: 2.7, aov: 239, color: ["#fbc2eb", "#a6c1ee"] },
  { name: "初见面部护理店", short: "护理", orgId: "712000000000000012", status: "审核中", role: "优化师", followed: false, remark: "资质补充审核中", budget: 5000, scale: 900, roiBase: 2.4, aov: 189, color: ["#c2e9fb", "#a1c4fd"] },
  { name: "简味食品旗舰店", short: "简味", orgId: "712000000000000013", status: "投放中", role: "管理员", followed: true, remark: "零食年货季重点", budget: 22000, scale: 14500, roiBase: 5.1, aov: 89, color: ["#f6d365", "#fda085"] },
  { name: "简味零食专营店", short: "零食", orgId: "712000000000000013", status: "投放中", role: "优化师", followed: true, remark: "直播间引流账户", budget: 9000, scale: 5200, roiBase: 3.8, aov: 69, color: ["#fddb92", "#d1fdff"] },
  { name: "源本茶饮旗舰店", short: "源本", orgId: "712000000000000013", status: "投放中", role: "优化师", followed: false, remark: "茶饮新品测试", budget: 6000, scale: 2800, roiBase: 2.6, aov: 129, color: ["#96fbc4", "#f9f586"] },
  { name: "源本生活馆", short: "生活馆", orgId: "712000000000000013", status: "已暂停", role: "观察者", followed: false, remark: "暂停，等待新素材", budget: 4000, scale: 700, roiBase: 2.0, aov: 149, color: ["#cfd9df", "#e2ebf0"] },
  { name: "元气小铺旗舰店", short: "元气", orgId: "712000000000000013", status: "余额不足", role: "优化师", followed: false, remark: "余额不足，预计影响跑量", budget: 7000, scale: 1900, roiBase: 2.8, aov: 109, color: ["#ffd1ff", "#f8c8ff"] },
  { name: "星野数码旗舰店", short: "星野", orgId: "712000000000000021", status: "投放中", role: "管理员", followed: true, remark: "3C 数码，咨询量高", budget: 18000, scale: 10400, roiBase: 3.0, aov: 899, color: ["#89f7fe", "#66a6ff"] },
  { name: "星野数码官方店", short: "官方", orgId: "712000000000000021", status: "投放中", role: "优化师", followed: false, remark: "官方号自播账户", budget: 12000, scale: 6100, roiBase: 3.3, aov: 1299, color: ["#667eea", "#764ba2"] },
  { name: "潮玩星球旗舰店", short: "潮玩", orgId: "712000000000000021", status: "投放中", role: "优化师", followed: true, remark: "IP 联名款起量中", budget: 10000, scale: 5900, roiBase: 3.9, aov: 199, color: ["#f093fb", "#f5576c"] },
  { name: "潮玩星球 IP 店", short: "IP店", orgId: "712000000000000021", status: "投放中", role: "观察者", followed: false, remark: "新品预售承接", budget: 5000, scale: 2200, roiBase: 2.5, aov: 259, color: ["#4facfe", "#00f2fe"] },
  { name: "沐野运动旗舰店", short: "沐野", orgId: "712000000000000022", status: "投放中", role: "管理员", followed: true, remark: "户外运动，冬季起量", budget: 14000, scale: 7300, roiBase: 3.5, aov: 359, color: ["#43e97b", "#38f9d7"] },
  { name: "沐野户外专营店", short: "户外", orgId: "712000000000000022", status: "投放中", role: "优化师", followed: false, remark: "直播间引流测试", budget: 6000, scale: 2600, roiBase: 2.7, aov: 429, color: ["#30cfd0", "#330867"] },
  { name: "时光好物旗舰店", short: "时光", orgId: "712000000000000022", status: "投放中", role: "优化师", followed: false, remark: "本地生活团购", budget: 8000, scale: 3600, roiBase: 2.3, aov: 159, color: ["#f7971e", "#ffd200"] },
  { name: "拾光会员商店", short: "会员店", orgId: "712000000000000011", status: "投放中", role: "观察者", followed: false, remark: "会员复购承接", budget: 4000, scale: 1600, roiBase: 3.2, aov: 299, color: ["#e0c3fc", "#8ec5fc"] },
];

const BRAND_BLUEPRINT: {
  name: string;
  short: string;
  orgId: string;
  status: AccountStatus;
  role: Account["role"];
  followed: boolean;
  remark: string;
  budget: number;
  scale: number;
  ctr: number;
  color: [string, string];
}[] = [
  { name: "花间集品牌旗舰店", short: "花间", orgId: "712000000000000031", status: "投放中", role: "管理员", followed: true, remark: "品牌春季上新曝光", budget: 30000, scale: 16000, ctr: 2.1, color: ["#ff9a8b", "#ff6a88"] },
  { name: "拾光服饰品牌店", short: "拾光", orgId: "712000000000000031", status: "投放中", role: "优化师", followed: false, remark: "大促品牌种草", budget: 26000, scale: 13200, ctr: 1.8, color: ["#a18cd1", "#fbc2eb"] },
  { name: "初见美妆品牌店", short: "初见", orgId: "712000000000000031", status: "投放中", role: "管理员", followed: true, remark: "新品精华曝光", budget: 42000, scale: 22800, ctr: 2.6, color: ["#ff9a9e", "#fecfef"] },
  { name: "简味食品品牌店", short: "简味", orgId: "712000000000000031", status: "投放中", role: "优化师", followed: true, remark: "年货节品牌曝光", budget: 36000, scale: 19400, ctr: 2.4, color: ["#f6d365", "#fda085"] },
  { name: "轻氧家居品牌店", short: "轻氧", orgId: "712000000000000031", status: "余额不足", role: "观察者", followed: false, remark: "余额不足，曝光受限", budget: 12000, scale: 2600, ctr: 1.5, color: ["#a1c4fd", "#c2e9fb"] },
  { name: "星野数码品牌店", short: "星野", orgId: "712000000000000031", status: "投放中", role: "管理员", followed: true, remark: "新品发布品牌大曝光", budget: 50000, scale: 27400, ctr: 1.9, color: ["#89f7fe", "#66a6ff"] },
  { name: "潮玩星球品牌店", short: "潮玩", orgId: "712000000000000032", status: "投放中", role: "优化师", followed: false, remark: "IP 联名品牌活动", budget: 20000, scale: 9800, ctr: 2.2, color: ["#f093fb", "#f5576c"] },
  { name: "沐野运动品牌店", short: "沐野", orgId: "712000000000000032", status: "投放中", role: "优化师", followed: true, remark: "户外场景品牌投放", budget: 24000, scale: 11200, ctr: 2.0, color: ["#43e97b", "#38f9d7"] },
  { name: "源本品牌店", short: "源本", orgId: "712000000000000032", status: "已暂停", role: "观察者", followed: false, remark: "品牌排期结束", budget: 8000, scale: 1200, ctr: 1.3, color: ["#96fbc4", "#f9f586"] },
  { name: "时光好物品牌店", short: "时光", orgId: "712000000000000032", status: "投放中", role: "优化师", followed: false, remark: "本地生活品牌曝光", budget: 16000, scale: 7200, ctr: 1.7, color: ["#f7971e", "#ffd200"] },
  { name: "元气小铺品牌店", short: "元气", orgId: "712000000000000032", status: "投放中", role: "观察者", followed: false, remark: "会员日品牌活动", budget: 14000, scale: 6100, ctr: 2.3, color: ["#ffd1ff", "#f8c8ff"] },
  { name: "禾颂品牌店", short: "禾颂", orgId: "712000000000000032", status: "审核中", role: "优化师", followed: false, remark: "素材审核中", budget: 10000, scale: 1900, ctr: 1.6, color: ["#ffecd2", "#fcb69f"] },
];

function buildAuctionSeries(seed: string, scale: number, roiBase: number, aov: number, activeFactor: number): DailyPoint[] {
  return DATE_KEYS.map((date, index) => {
    const weekday = parseDateKey(date).getDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.12 : 1;
    const wave = 1 + Math.sin(index / 6.2 + hash(seed) % 10) * 0.14;
    const noise = randRange(`${seed}-noise`, index, 0.72, 1.3);
    const active = rand(`${seed}-active`, index) > 0.06 ? 1 : 0;
    const cost = Math.round(scale * weekend * wave * noise * active * activeFactor);
    if (cost === 0) {
      return { date, cost: 0, orders: 0, revenue: 0, show: 0, click: 0 };
    }
    const roi = Math.max(0.8, roiBase * randRange(`${seed}-roi`, index, 0.82, 1.18));
    const revenue = Math.round(cost * roi * randRange(`${seed}-rev`, index, 0.96, 1.05));
    const orders = Math.max(1, Math.round(revenue / aov));
    const cpm = randRange(`${seed}-cpm`, index, 16, 34);
    const show = Math.round((cost / cpm) * 1000);
    const ctr = randRange(`${seed}-ctr`, index, 1.4, 4.6) / 100;
    const click = Math.round(show * ctr);
    const refundRate = Math.round(randRange(`${seed}-refund`, index, 0.04, 0.2) * 1000) / 1000;
    const netRevenue = Math.round(revenue * (1 - refundRate));
    const netOrders = Math.max(0, Math.round(orders * (1 - refundRate)));
    return {
      date,
      cost,
      orders,
      revenue,
      show,
      click,
      netRevenue,
      netOrders,
      refundAmount: revenue - netRevenue,
      refundRate,
    };
  });
}

function buildBrandSeries(seed: string, scale: number, ctrBase: number, activeFactor: number): DailyPoint[] {
  return DATE_KEYS.map((date, index) => {
    const weekday = parseDateKey(date).getDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.18 : 1;
    const wave = 1 + Math.cos(index / 5.4 + (hash(seed) % 7)) * 0.16;
    const noise = randRange(`${seed}-noise`, index, 0.7, 1.32);
    const active = rand(`${seed}-active`, index) > 0.08 ? 1 : 0;
    const cost = Math.round(scale * weekend * wave * noise * active * activeFactor);
    if (cost === 0) {
      return { date, cost: 0, orders: 0, revenue: 0, show: 0, click: 0 };
    }
    const cpm = randRange(`${seed}-cpm`, index, 9, 26);
    const show = Math.round((cost / cpm) * 1000);
    const ctr = randRange(`${seed}-ctr`, index, ctrBase - 0.4, ctrBase + 0.5) / 100;
    const click = Math.round(show * ctr);
    return {
      date,
      cost,
      orders: 0,
      revenue: 0,
      show,
      click,
      netRevenue: 0,
      netOrders: 0,
      refundAmount: 0,
      refundRate: 0,
    };
  });
}

const STATUS_ACTIVITY: Record<AccountStatus, number> = {
  投放中: 1,
  已暂停: 0,
  余额不足: 0.25,
  审核中: 0.35,
  已结束: 0,
};

export const ACCOUNTS: Account[] = [
  ...AUCTION_BLUEPRINT.map((item, index) => {
    const id = `1723${String(560000000000 + index * 977 + 431).padStart(12, "0")}`.slice(0, 16);
    const lagMinutes = Math.round(randRange(`${id}-lag`, 0, 2, 22));
    const authorization = authorizationFor(index);
    const dataSources = dataSourcesFor(index, authorization);
    const daily = netAvailability(
      buildAuctionSeries(id, item.scale, item.roiBase, item.aov, STATUS_ACTIVITY[item.status]),
      dataSources,
    );
    const balance = item.status === "余额不足" ? Math.round(randRange(`${id}-bal`, 0, 180, 4800)) : Math.round(randRange(`${id}-bal`, 0, 8000, 168000));
    return {
      id,
      name: item.name,
      short: item.short,
      orgId: item.orgId,
      channel: "auction" as const,
      status: item.status,
      role: item.role,
      followed: item.followed,
      budget: item.budget,
      balance,
      remark: item.remark,
      authorization,
      dataSources,
      lastSyncedAt: syncedAt(lagMinutes),
      dataLagMinutes: lagMinutes,
      effectiveBalance: authorization === "部分授权" ? null : Math.round(balance * 0.86),
      sharedWalletBalance: index % 3 === 0 ? Math.round(balance * 1.6) : null,
      color: item.color,
      daily,
    };
  }),
  ...BRAND_BLUEPRINT.map((item, index) => {
    const id = `1798${String(310000000000 + index * 631 + 257).padStart(12, "0")}`.slice(0, 16);
    const lagMinutes = Math.round(randRange(`${id}-lag`, 0, 2, 18));
    const authorization = authorizationFor(index + 7);
    const dataSources = dataSourcesFor(index + 7, authorization);
    const daily = netAvailability(
      buildBrandSeries(id, item.scale, item.ctr, STATUS_ACTIVITY[item.status]),
      dataSources,
    );
    const balance = item.status === "余额不足" ? Math.round(randRange(`${id}-bal`, 0, 1200, 4200)) : Math.round(randRange(`${id}-bal`, 0, 12000, 260000));
    return {
      id,
      name: item.name,
      short: item.short,
      orgId: item.orgId,
      channel: "brand" as const,
      status: item.status,
      role: item.role,
      followed: item.followed,
      budget: item.budget,
      balance,
      remark: item.remark,
      authorization,
      dataSources,
      lastSyncedAt: syncedAt(lagMinutes),
      dataLagMinutes: lagMinutes,
      effectiveBalance: authorization === "部分授权" ? null : Math.round(balance * 0.86),
      sharedWalletBalance: index % 3 === 0 ? Math.round(balance * 1.6) : null,
      color: item.color,
      daily,
    };
  }),
];

export function accountById(id: string): Account | undefined {
  return ACCOUNTS.find((account) => account.id === id);
}

export function accountsOfOrgs(orgIds: string[], channel?: Channel): Account[] {
  const set = new Set(orgIds);
  return ACCOUNTS.filter(
    (account) => set.has(account.orgId) && (!channel || account.channel === channel),
  );
}

/* ------------------------------------------------------------------ */
/* Campaigns / plans                                                  */
/* ------------------------------------------------------------------ */

const PLAN_SUFFIXES = [
  { name: "短视频带货", target: "推商品" as const },
  { name: "直播间引流", target: "推直播间" as const },
  { name: "商品卡推广", target: "推商品" as const },
  { name: "达人相似人群", target: "推商品" as const },
  { name: "晚场直播冲刺", target: "推直播间" as const },
  { name: "爆品追投", target: "推商品" as const },
];

type ProductSeed = { name: string; price: number; emoji: string };

const PRODUCT_POOLS: { match: RegExp; category: string; products: ProductSeed[] }[] = [
  {
    match: /初见/,
    category: "美妆个护",
    products: [
      { name: "氨基酸洁面乳", price: 129, emoji: "🧴" },
      { name: "高光妆前乳", price: 239, emoji: "💄" },
      { name: "玻尿酸保湿精华", price: 299, emoji: "🧪" },
      { name: "轻透防晒霜", price: 159, emoji: "🌤️" },
      { name: "净澈卸妆油", price: 119, emoji: "🫧" },
    ],
  },
  {
    match: /简味|源本|元气/,
    category: "食品饮料",
    products: [
      { name: "每日坚果礼盒", price: 99, emoji: "🥜" },
      { name: "冷萃茶包组合", price: 79, emoji: "🍵" },
      { name: "原味燕麦奶 12 盒", price: 109, emoji: "🥛" },
      { name: "冻干咖啡 24 颗", price: 89, emoji: "☕" },
      { name: "手撕面包整箱", price: 39, emoji: "🍞" },
    ],
  },
  {
    match: /星野|潮玩/,
    category: "数码潮玩",
    products: [
      { name: "无线降噪耳机", price: 899, emoji: "🎧" },
      { name: "便携蓝牙音箱", price: 299, emoji: "🔊" },
      { name: "智能运动手表", price: 1299, emoji: "⌚" },
      { name: "联名盲盒手办", price: 199, emoji: "🧸" },
      { name: "智能保温杯", price: 159, emoji: "🍶" },
    ],
  },
  {
    match: /沐野/,
    category: "户外运动",
    products: [
      { name: "轻量徒步鞋", price: 459, emoji: "🥾" },
      { name: "防风冲锋衣", price: 699, emoji: "🧥" },
      { name: "户外双肩包", price: 299, emoji: "🎒" },
      { name: "速干运动套装", price: 399, emoji: "🏃" },
    ],
  },
  {
    match: /轻氧|禾颂/,
    category: "家居家纺",
    products: [
      { name: "轻盈鹅绒被", price: 399, emoji: "🛏️" },
      { name: "纯棉四件套", price: 499, emoji: "🧺" },
      { name: "香薰礼盒", price: 199, emoji: "🕯️" },
      { name: "记忆棉护颈枕", price: 169, emoji: "🛌" },
    ],
  },
  {
    match: /花间|拾光/,
    category: "服饰生活",
    products: [
      { name: "法式碎花连衣裙", price: 268, emoji: "👗" },
      { name: "高腰直筒牛仔裤", price: 199, emoji: "👖" },
      { name: "羊毛混纺大衣", price: 599, emoji: "🧥" },
      { name: "真丝睡衣套装", price: 329, emoji: "👘" },
    ],
  },
  {
    match: /时光/,
    category: "本地生活",
    products: [
      { name: "双人餐套餐", price: 199, emoji: "🍽️" },
      { name: "咖啡双杯券", price: 59, emoji: "☕" },
      { name: "洗车服务券", price: 99, emoji: "🚗" },
    ],
  },
];

const DEFAULT_PRODUCTS: ProductSeed[] = [
  { name: "每日坚果礼盒", price: 99, emoji: "🥜" },
  { name: "氨基酸洁面乳", price: 129, emoji: "🧴" },
  { name: "法式碎花连衣裙", price: 268, emoji: "👗" },
  { name: "无线降噪耳机", price: 899, emoji: "🎧" },
];

function productPoolForAccount(account: Account): { category: string; products: ProductSeed[] } {
  return (
    PRODUCT_POOLS.find((pool) => pool.match.test(account.name)) ?? {
      category: "综合",
      products: DEFAULT_PRODUCTS,
    }
  );
}

export const PRODUCTS: Product[] = ACCOUNTS.flatMap((account, accountIndex) => {
  const pool = productPoolForAccount(account);
  return pool.products.map((seed, index) => {
    const isLast = index === pool.products.length - 1;
    const status: ProductStatus = isLast
      ? accountIndex % 3 === 0
        ? "售罄"
        : accountIndex % 3 === 1
          ? "审核中"
          : "已下架"
      : "在售";
    const id = `prod_${account.id}_${index + 1}`;
    return {
      id,
      accountId: account.id,
      channel: account.channel,
      category: pool.category,
      ...seed,
      status,
      stock: status === "在售" ? 2000 + (hash(id) % 6000) : 0,
    };
  });
});

export const PRODUCT_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));

export function productById(id: string): Product | undefined {
  return PRODUCT_BY_ID.get(id);
}

export function productsOfAccount(accountId: string): Product[] {
  return PRODUCTS.filter((product) => product.accountId === accountId);
}

function buildCampaignSeries(accountDaily: DailyPoint[], seed: string, share: number): DailyPoint[] {
  return accountDaily.map((point, index) => {
    if (point.cost === 0) return { ...point };
    const weight = share * randRange(`${seed}-share`, index, 0.82, 1.18);
    const cost = Math.round(point.cost * weight);
    const revenue = Math.round(point.revenue * weight * randRange(`${seed}-rr`, index, 0.92, 1.08));
    const orders = Math.max(0, Math.round(point.orders * weight));
    const show = Math.round(point.show * weight);
    const click = Math.round(point.click * weight);
    // 净成交按账户净成交比例落到计划，保证 revenue - refundAmount = netRevenue 可对账。
    const netRatio = point.netRevenue == null || point.revenue <= 0 ? null : point.netRevenue / point.revenue;
    const netRevenue = netRatio == null ? null : Math.round(revenue * netRatio);
    const refundAmount = netRevenue == null ? null : Math.max(0, revenue - netRevenue);
    const netOrders = netRevenue == null ? null : Math.max(0, Math.round(orders * (revenue > 0 ? netRevenue / revenue : 0)));
    return {
      date: point.date,
      cost,
      orders,
      revenue,
      show,
      click,
      netRevenue,
      netOrders,
      refundAmount,
      refundRate: refundAmount == null || revenue <= 0 ? null : refundAmount / revenue,
    };
  });
}

export const CAMPAIGNS: Campaign[] = ACCOUNTS.filter((account) => account.channel === "auction").flatMap(
  (account, accountIndex) => {
    const count = 2 + (accountIndex % 3);
    return Array.from({ length: count }, (_, planIndex) => {
      const suffix = PLAN_SUFFIXES[(accountIndex + planIndex) % PLAN_SUFFIXES.length];
      const sellable = productsOfAccount(account.id).filter((product) => product.status === "在售");
      const product = sellable[(accountIndex + planIndex) % sellable.length] ?? productsOfAccount(account.id)[0];
      const mode: AuctionMode = planIndex % 3 === 0 ? "标准推广" : "全域推广";
      const id = `1739${String(810000000000 + accountIndex * 7919 + planIndex * 613).padStart(12, "0")}`.slice(0, 16);
      const seed = `${account.id}-p${planIndex}`;
      const status: CampaignStatus =
        account.status === "已暂停" || account.status === "已结束"
          ? "已暂停"
          : account.status === "余额不足" && planIndex === 0
            ? "已暂停"
            : planIndex === 2 && accountIndex % 7 === 0
              ? "审核中"
              : "投放中";
      const learningPhase: Campaign["learningPhase"] =
        status === "审核中" ? "未进入" : status === "投放中" && planIndex === 0 ? "学习中" : "已成长期";
      const learningDays = learningPhase === "学习中" ? 3 + (hash(seed) % 12) : 0;
      const learningStartedAt = learningDays > 0 ? toLocalTime(addDays(TODAY, -learningDays)) : null;
      return {
        id,
        name: `${mode === "全域推广" ? "全域" : "标准"}-${product.name}-${suffix.name}`,
        accountId: account.id,
        channel: "auction" as const,
        mode,
        target: suffix.target,
        status,
        budget: Math.round(account.budget * randRange(`${seed}-budget`, 0, 0.25, 0.6)),
        bid: Math.round(randRange(`${seed}-bid`, 0, 8, 68)),
        bidStrategy: planIndex % 3 === 0 ? "控成本投放" : "放量投放",
        roiGoal: Math.round(randRange(`${seed}-roi-goal`, 0, 2.8, 4.8) * 10) / 10,
        optimizationGoal: suffix.target === "推直播间" ? "直播间成交" : "商品支付ROI",
        scheduleType: accountIndex % 4 === 0 ? "指定时段" : "全天",
        schedule: accountIndex % 4 === 0 ? "09:00-23:00" : "00:00-24:00",
        audience: {
          gender: pick(`${seed}-gender`, 0, ["不限", "不限", "女", "男"] as const),
          age: pick(`${seed}-age`, 0, ["18-30", "24-40", "18-40", "30-50"] as const),
          regions: pick(`${seed}-region`, 0, [["全国"], ["华东", "华南"], ["华东"], ["华南", "西南"]] as const),
          interests: [product.category, suffix.name],
        },
        creativeIds: [],
        landingPage: suffix.target === "推直播间" ? "直播间" : "商品详情页",
        liveRoomId: suffix.target === "推直播间" ? `live_${hash(seed) % 100000}` : undefined,
        liveRoomTitle: suffix.target === "推直播间" ? `${account.short}直播间` : undefined,
        learningPhase,
        learningStartedAt,
        learningDays,
        rejectReason: status === "审核中" ? "素材涉及功效表述，待修改" : null,
        createdAt: toLocalTime(addDays(TODAY, -(35 + (hash(seed) % 60)))),
        updatedAt: toLocalTime(addDays(TODAY, -(hash(`${seed}-update`) % 3))),
        changes: [],
        douyinId: `6${String(hash(seed) % 100000000).padStart(8, "0")}`,
        productId: product.id,
        daily: buildCampaignSeries(account.daily, seed, 1 / (count + 0.6)),
      };
    });
  },
);

export const BRAND_CAMPAIGNS: Campaign[] = ACCOUNTS.filter((account) => account.channel === "brand").flatMap(
  (account, accountIndex) => {
    const count = 1 + (accountIndex % 2);
    return Array.from({ length: count }, (_, campaignIndex) => {
      const sellable = productsOfAccount(account.id).filter((product) => product.status === "在售");
      const product = sellable[(accountIndex + campaignIndex) % sellable.length] ?? productsOfAccount(account.id)[0];
      const id = `1764${String(920000000000 + accountIndex * 4211 + campaignIndex * 337).padStart(12, "0")}`.slice(0, 16);
      const seed = `${account.id}-b${campaignIndex}`;
      return {
        id,
        name: `${product.name} · 品牌${campaignIndex === 0 ? "曝光" : "搜索"}计划`,
        accountId: account.id,
        channel: "brand" as const,
        mode: "品牌预定单" as const,
        target: "推商品" as const,
        brandPlacement: campaignIndex === 1 ? "品牌搜索" : "品牌信息流",
        status: account.status === "已暂停" ? "已暂停" : "投放中",
        budget: Math.round(account.budget * randRange(`${seed}-budget`, 0, 0.3, 0.7)),
        bid: Math.round(randRange(`${seed}-bid`, 0, 6, 30)),
        bidStrategy: "控成本投放",
        roiGoal: null,
        optimizationGoal: "品牌曝光",
        scheduleType: "全天",
        schedule: "00:00-24:00",
        audience: {
          gender: "不限",
          age: "18-40",
          regions: ["全国"],
          interests: [product.category, "品牌人群"],
        },
        creativeIds: [],
        landingPage: "商品详情页",
        learningPhase: "已成长期",
        learningStartedAt: null,
        learningDays: 0,
        rejectReason: null,
        createdAt: toLocalTime(addDays(TODAY, -(40 + (hash(seed) % 50)))),
        updatedAt: toLocalTime(addDays(TODAY, -(hash(`${seed}-update`) % 4))),
        changes: [],
        douyinId: `6${String(hash(seed) % 100000000).padStart(8, "0")}`,
        productId: product.id,
        daily: buildCampaignSeries(account.daily, seed, 1 / (count + 0.8)),
      };
    });
  },
);

/**
 * 让计划日序列严格加总到账户日序列。
 * 否则“按投放方式/推广目标切片”会和账户 KPI 对不上。
 */
function normalizeCampaignsToAccounts(campaigns: Campaign[], accounts: Account[]) {
  const fields: ("cost" | "revenue" | "orders" | "show" | "click" | "netRevenue" | "netOrders")[] = [
    "cost",
    "revenue",
    "orders",
    "show",
    "click",
    "netRevenue",
    "netOrders",
  ];
  for (const account of accounts) {
    const list = campaigns.filter((campaign) => campaign.accountId === account.id);
    if (list.length === 0) continue;
    for (const accountPoint of account.daily) {
      const points = list
        .map((campaign) => campaign.daily.find((point) => point.date === accountPoint.date))
        .filter((point): point is DailyPoint => Boolean(point));
      for (const field of fields) {
        const target = accountPoint[field];
        if (target === null || target === undefined) {
          if (field === "netRevenue" || field === "netOrders") {
            points.forEach((point) => {
              point[field] = null;
            });
          }
          continue;
        }
        const sum = points.reduce((total, point) => total + (point[field] ?? 0), 0);
        if (sum <= 0) {
          points.forEach((point, index) => {
            point[field] = index === 0 ? target : 0;
          });
          continue;
        }
        const values = points.map((point) => Math.max(0, Math.round(((point[field] ?? 0) / sum) * target)));
        let diff = target - values.reduce((total, value) => total + value, 0);
        let index = 0;
        while (diff !== 0 && values.length > 0) {
          const bucket = index % values.length;
          if (diff > 0) {
            values[bucket] += diff;
            diff = 0;
          } else if (values[bucket] > 0) {
            const take = Math.min(values[bucket], -diff);
            values[bucket] -= take;
            diff += take;
          }
          index += 1;
          if (index > values.length * 2) break;
        }
        points.forEach((point, pointIndex) => {
          point[field] = values[pointIndex];
        });
      }
      // 退款金额由净成交推导，保证每个计划日都满足 revenue - refundAmount = netRevenue。
      for (const point of points) {
        point.refundAmount = point.netRevenue == null ? null : Math.max(0, point.revenue - point.netRevenue);
        point.refundRate = point.refundAmount == null || point.revenue <= 0 ? null : point.refundAmount / point.revenue;
      }
    }
  }
}

normalizeCampaignsToAccounts(
  CAMPAIGNS,
  ACCOUNTS.filter((account) => account.channel === "auction"),
);
normalizeCampaignsToAccounts(
  BRAND_CAMPAIGNS,
  ACCOUNTS.filter((account) => account.channel === "brand"),
);

/* 造 2 个“高消耗 + 低库存”的真实风险场景，供库存止损技能使用 */
const stockRiskCandidates = CAMPAIGNS.filter((campaign) => {
  const product = PRODUCTS.find((item) => item.id === campaign.productId);
  return campaign.status === "投放中" && product?.status === "在售";
})
  .map((campaign) => {
    const cost = campaign.daily.slice(-7).reduce((sum, point) => sum + point.cost, 0);
    const orders = campaign.daily.slice(-7).reduce((sum, point) => sum + point.orders, 0);
    return { campaign, cost, ordersPerDay: orders / 7 };
  })
  .filter((item) => item.cost > 0 && item.ordersPerDay > 0)
  .sort((left, right) => right.cost - left.cost);

const seenStockProducts = new Set<string>();
for (const item of stockRiskCandidates) {
  if (seenStockProducts.size >= 2) break;
  if (seenStockProducts.has(item.campaign.productId)) continue;
  const product = PRODUCTS.find((entry) => entry.id === item.campaign.productId);
  if (!product) continue;
  product.stock = Math.max(20, Math.round(item.ordersPerDay * 3));
  seenStockProducts.add(product.id);
}


/* ------------------------------------------------------------------ */
/* Creatives / change records / data health                           */
/* ------------------------------------------------------------------ */

const CREATIVE_HOOKS: CreativeHook[] = ["真实测评", "场景种草", "低价钩子", "参数罗列", "直播切片", "达人同款"];
const CREATIVE_REJECT_REASONS = ["素材涉及功效表述", "画面含第三方平台标识", "背景音乐版权待确认"];

/** 素材原型：这些是隐藏参数，Agent 只能看到结果，不能直接看到这张表 */
const CREATIVE_ARCHETYPES: Record<
  CreativeHook,
  { spend: number; cpm: number; ctr: number; cvr: number; aov: number; refund: number; completion: number; decay: number }
> = {
  真实测评: { spend: 1.0, cpm: 1.0, ctr: 1.0, cvr: 1.25, aov: 1.0, refund: 0.75, completion: 0.32, decay: 0.97 },
  场景种草: { spend: 1.1, cpm: 1.05, ctr: 1.2, cvr: 1.0, aov: 1.0, refund: 0.85, completion: 0.35, decay: 0.94 },
  低价钩子: { spend: 1.25, cpm: 0.9, ctr: 1.45, cvr: 1.15, aov: 0.8, refund: 1.9, completion: 0.4, decay: 0.88 },
  参数罗列: { spend: 0.75, cpm: 1.0, ctr: 0.75, cvr: 0.8, aov: 1.0, refund: 1.05, completion: 0.22, decay: 0.9 },
  直播切片: { spend: 1.1, cpm: 1.1, ctr: 1.3, cvr: 1.1, aov: 1.0, refund: 1.0, completion: 0.3, decay: 0.95 },
  达人同款: { spend: 0.95, cpm: 1.0, ctr: 0.95, cvr: 1.1, aov: 1.05, refund: 0.8, completion: 0.28, decay: 0.96 },
};

/** 最大余数法：把 total 拆成整数，且和严格等于 total */
function allocateIntegers(total: number, weights: number[]): number[] {
  const size = weights.length;
  if (size === 0) return [];
  if (!Number.isFinite(total) || total <= 0) return Array(size).fill(0);
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = clean.reduce((acc, weight) => acc + weight, 0);
  const normalized = sum > 0 ? clean.map((weight) => weight / sum) : Array(size).fill(1 / size);
  const raw = normalized.map((weight) => total * weight);
  const result = raw.map((value) => Math.floor(value));
  let remainder = total - result.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let cursor = 0; cursor < remainder; cursor += 1) result[order[cursor % size].index] += 1;
  return result;
}

function buildCreativeSeries(campaign: Campaign, creatives: Creative[]): void {
  const launches = creatives.map((creative) => dayIndexOf(creative.createdAt.slice(0, 10)));
  const archetypes = creatives.map((creative) => CREATIVE_ARCHETYPES[creative.hook]);
  const series = creatives.map(() => [] as CreativeDaily[]);

  campaign.daily.forEach((point) => {
    const dayIndex = dayIndexOf(point.date);
    const active = creatives.map((creative) => creative.auditStatus === "通过" && point.cost > 0);
    const weights = creatives.map((creative, index) => {
      if (!active[index]) {
        return { cost: 0, show: 0, click: 0, order: 0, revenue: 0, refund: 0, netOrder: 0 };
      }
      const age = dayIndex - launches[index];
      const ramp = age < 3 ? 0.35 + age * 0.22 : 1;
      const decay = age > 12 ? Math.pow(archetypes[index].decay, age - 12) : 1;
      const life = Math.max(0.22, ramp * decay);
      const noise = (salt: string) => randRange(`${creative.id}-${salt}`, dayIndex, 0.82, 1.18);
      const show = (life * archetypes[index].spend) / archetypes[index].cpm * noise("show");
      const click = show * archetypes[index].ctr * noise("click");
      const order = click * archetypes[index].cvr * noise("order");
      const revenue = order * archetypes[index].aov * noise("revenue");
      return {
        cost: show * archetypes[index].cpm * noise("cost"),
        show,
        click,
        order,
        revenue,
        refund: revenue * archetypes[index].refund * noise("refund"),
        netOrder: order * noise("net-order"),
      };
    });

    const split = (key: keyof (typeof weights)[number], total: number | null | undefined) =>
      total == null ? null : allocateIntegers(total, weights.map((weight) => weight[key]));
    const show = split("show", point.show) ?? [];
    const click = split("click", point.click) ?? [];
    const cost = split("cost", point.cost) ?? [];
    const orders = split("order", point.orders) ?? [];
    const revenue = split("revenue", point.revenue) ?? [];
    const refund = split("refund", point.refundAmount);
    const netOrders = split("netOrder", point.netOrders);

    creatives.forEach((creative, index) => {
      const activeDay = active[index];
      const refundValue = refund == null ? null : refund[index];
      const revenueValue = revenue[index] ?? 0;
      const completion =
        !activeDay || creative.durationSeconds === 0
          ? null
          : Math.min(
              0.75,
              Math.max(
                0.05,
                archetypes[index].completion *
                  (0.9 + 0.2 * Math.max(0.2, 1 - Math.abs(dayIndex - launches[index]) / 60)) *
                  randRange(`${creative.id}-completion`, dayIndex, 0.9, 1.1),
              ),
            );
      series[index].push({
        date: point.date,
        cost: cost[index] ?? 0,
        orders: orders[index] ?? 0,
        revenue: revenueValue,
        show: show[index] ?? 0,
        click: click[index] ?? 0,
        netRevenue: refundValue == null ? null : revenueValue - refundValue,
        netOrders: netOrders == null ? null : netOrders[index] ?? null,
        refundAmount: refundValue,
        refundRate: refundValue == null || revenueValue <= 0 ? null : refundValue / revenueValue,
        completion5s: completion == null ? null : Math.round(completion * 1000) / 1000,
      });
    });
  });

  creatives.forEach((creative, index) => {
    creative.daily = series[index];
  });
}

export const CREATIVES: Creative[] = [...CAMPAIGNS, ...BRAND_CAMPAIGNS].flatMap((campaign) => {
  const isBrand = campaign.channel === "brand";
  const count = isBrand
    ? 2 + (hash(`${campaign.id}-creative-count`) % 2)
    : 3 + (hash(`${campaign.id}-creative-count`) % 2);
  const creatives = Array.from({ length: count }, (_, index) => {
    const seed = `${campaign.id}-c${index}`;
    const hook: CreativeHook =
      campaign.target === "推直播间" && index === 0
        ? "直播切片"
        : CREATIVE_HOOKS[hash(`${seed}-hook`) % CREATIVE_HOOKS.length];
    const type: Creative["type"] =
      hook === "直播切片" ? "直播间" : hook === "参数罗列" || index % 4 === 3 ? "图片" : "短视频";
    const durationSeconds = type === "图片" ? 0 : type === "直播间" ? 45 + (hash(seed) % 46) : 15 + (hash(seed) % 31);
    const auditStatus: Creative["auditStatus"] =
      campaign.status === "审核中" && index === 0
        ? "审核中"
        : hash(`${seed}-audit`) % 15 === 0
          ? "拒绝"
          : "通过";
    return {
      id: `cr_${campaign.id}_${index + 1}`,
      accountId: campaign.accountId,
      campaignId: campaign.id,
      type,
      hook,
      title: `${productById(campaign.productId)?.name ?? "商品"}-${hook}${index + 1}`,
      durationSeconds,
      auditStatus,
      rejectReason:
        auditStatus === "拒绝" ? CREATIVE_REJECT_REASONS[hash(`${seed}-reason`) % CREATIVE_REJECT_REASONS.length] : null,
      createdAt: toLocalTime(addDays(TODAY, -(4 + (hash(`${seed}-age`) % 40)))),
      daily: [],
    } satisfies Creative;
  });
  // 保证每个计划至少有一条过审素材，否则计划不应有消耗。
  if (creatives.every((creative) => creative.auditStatus === "拒绝")) {
    creatives[0].auditStatus = "通过";
    creatives[0].rejectReason = null;
  }
  for (const creative of creatives) campaign.creativeIds.push(creative.id);
  buildCreativeSeries(campaign, creatives);
  return creatives;
});

export const CREATIVE_BY_ID = new Map(CREATIVES.map((creative) => [creative.id, creative]));

export function creativeById(id: string): Creative | undefined {
  return CREATIVE_BY_ID.get(id);
}

export interface CreativeMetrics {
  cost: number;
  show: number;
  click: number;
  orders: number;
  revenue: number;
  netRevenue: number | null;
  netOrders: number | null;
  refundAmount: number | null;
  completion5s: number | null;
  ctr: number | null;
  cvr: number | null;
  roi: number | null;
  cpa: number | null;
  refundRate: number | null;
  netRoi: number | null;
}

export function creativeMetrics(creative: Creative, range: DateRange): CreativeMetrics {
  const totals = { cost: 0, show: 0, click: 0, orders: 0, revenue: 0, netRevenue: 0, netOrders: 0, refundAmount: 0 };
  let hasNet = false;
  let hasRefund = false;
  let hasNetOrders = false;
  let completionSum = 0;
  let completionCount = 0;
  for (const point of creative.daily) {
    if (!inRange(point, range)) continue;
    totals.cost += point.cost;
    totals.show += point.show;
    totals.click += point.click;
    totals.orders += point.orders;
    totals.revenue += point.revenue;
    if (point.netRevenue != null) {
      totals.netRevenue += point.netRevenue;
      hasNet = true;
    }
    if (point.netOrders != null) {
      totals.netOrders += point.netOrders;
      hasNetOrders = true;
    }
    if (point.refundAmount != null) {
      totals.refundAmount += point.refundAmount;
      hasRefund = true;
    }
    if (point.completion5s != null && point.cost > 0) {
      completionSum += point.completion5s;
      completionCount += 1;
    }
  }
  const netRevenue = hasNet ? totals.netRevenue : null;
  return {
    cost: totals.cost,
    show: totals.show,
    click: totals.click,
    orders: totals.orders,
    revenue: totals.revenue,
    netRevenue,
    netOrders: hasNetOrders ? totals.netOrders : null,
    refundAmount: hasRefund ? totals.refundAmount : null,
    completion5s: completionCount > 0 ? completionSum / completionCount : null,
    ctr: totals.show > 0 ? (totals.click / totals.show) * 100 : null,
    cvr: totals.click > 0 ? (totals.orders / totals.click) * 100 : null,
    roi: totals.cost > 0 ? totals.revenue / totals.cost : null,
    cpa: totals.orders > 0 ? totals.cost / totals.orders : null,
    refundRate: hasRefund && totals.revenue > 0 ? (totals.refundAmount / totals.revenue) * 100 : null,
    netRoi: netRevenue != null && totals.cost > 0 ? netRevenue / totals.cost : null,
  };
}

const CHANGE_REASONS = ["日常巡检", "ROI 连续下滑", "预算撞线", "素材替换", "周末加投", "学习期调整"];
const CHANGE_ACTORS = ["张投手", "李优化", "王运营"];

export const CHANGES: ChangeEvent[] = [];

for (const campaign of CAMPAIGNS) {
  const count = 1 + (hash(`${campaign.id}-changes`) % 3);
  const changes: ChangeEvent[] = Array.from({ length: count }, (_, index) => {
    const seed = `${campaign.id}-change-${index}`;
    const field = pick(seed, 0, ["日预算", "出价", "投放状态"] as const);
    const at = toLocalTime(addDays(TODAY, -(1 + index * 4 + (hash(seed) % 3))));
    const actor = pick(seed, 1, CHANGE_ACTORS);
    const before =
      field === "日预算"
        ? `¥${Math.max(100, Math.round(campaign.budget * 0.8))}`
        : field === "出价"
          ? `¥${Math.max(1, Math.round(campaign.bid * 1.1))}`
          : campaign.status === "已暂停"
            ? "投放中"
            : "已暂停";
    const after =
      field === "日预算"
        ? `¥${Math.round(campaign.budget)}`
        : field === "出价"
          ? `¥${Math.round(campaign.bid)}`
          : campaign.status;
    return {
      id: `chg_${campaign.id}_${index + 1}`,
      accountId: campaign.accountId,
      campaignId: campaign.id,
      field,
      before,
      after,
      actor,
      actorType: "human" as const,
      source: "千川后台" as const,
      at,
      reason: CHANGE_REASONS[hash(seed) % CHANGE_REASONS.length],
      result: (hash(`${seed}-result`) % 13 === 0 ? "失败" : "成功") as "失败" | "成功",
    };
  }).sort((a, b) => b.at.localeCompare(a.at));
  campaign.changes = changes;
  CHANGES.push(...changes);
}

export function netTotalsOf(points: DailyPoint[]): NetTotals {
  const available = points.filter((point) => point.netRevenue !== null && point.netRevenue !== undefined);
  if (available.length === 0) {
    return { netRevenue: null, netOrders: null, refundAmount: null, refundRate: null };
  }
  const revenue = available.reduce((total, point) => total + point.revenue, 0);
  const netRevenue = available.reduce((total, point) => total + (point.netRevenue ?? 0), 0);
  const netOrders = available.reduce((total, point) => total + (point.netOrders ?? 0), 0);
  const refundAmount = Math.max(0, revenue - netRevenue);
  return {
    netRevenue,
    netOrders,
    refundAmount,
    refundRate: revenue > 0 ? refundAmount / revenue : null,
  };
}

export function dataHealthOf(account: Account): DataHealth {
  const missing: string[] = [];
  if (!account.dataSources.includes("商品交易")) missing.push("净成交/退款");
  if (account.authorization !== "已授权") missing.push("完整授权");
  const stale = account.dataLagMinutes > 10 ? [`报表延迟 ${account.dataLagMinutes} 分钟`] : [];
  return {
    accountId: account.id,
    completeness: Math.max(0.3, 1 - missing.length * 0.2 - (stale.length ? 0.1 : 0)),
    authorization: account.authorization,
    lastSyncedAt: account.lastSyncedAt,
    lagMinutes: account.dataLagMinutes,
    missing,
    stale,
  };
}

export function campaignsOfAccounts(accountIds: string[], channel?: Channel): Campaign[] {
  const set = new Set(accountIds);  return [...CAMPAIGNS, ...BRAND_CAMPAIGNS].filter(
    (campaign) => set.has(campaign.accountId) && (!channel || campaign.channel === channel),
  );
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                    */
/* ------------------------------------------------------------------ */

export function accountTotals(accounts: Account[], range: DateRange): Totals {
  return addTotals(accounts.map((account) => sumSeries(account.daily, range)));
}

export function campaignTotals(campaigns: Campaign[], range: DateRange): Totals {
  return addTotals(campaigns.map((campaign) => sumSeries(campaign.daily, range)));
}

export function sumBalance(accounts: Account[]): number {
  return accounts.reduce((sum, account) => sum + account.balance, 0);
}

export function todayCost(accounts: Account[]): number {
  const today = DATE_KEYS[DATE_KEYS.length - 1];
  return accounts.reduce((sum, account) => {
    const point = account.daily.find((p) => p.date === today);
    return sum + (point?.cost ?? 0);
  }, 0);
}

export function activeAccountCount(accounts: Account[], range: DateRange): number {
  return accounts.filter((account) => sumSeries(account.daily, range).cost > 0).length;
}

export function activeTodayCount(accounts: Account[]): number {
  const today = DATE_KEYS[DATE_KEYS.length - 1];
  return accounts.filter((account) => (account.daily.find((point) => point.date === today)?.cost ?? 0) > 0).length;
}

export function lowBalanceCount(accounts: Account[]): number {
  return accounts.filter((account) => account.balance < 5000).length;
}

export function orgTotal(orgId: string, range: DateRange, channel?: Channel): Totals {
  return accountTotals(accountsOfOrgs(descenders(orgId), channel), range);
}

export interface Delta {
  value: number | null;
  ratio: number | null;
  direction: "up" | "down" | "flat";
}

export function computeDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null || previous === 0) {
    return { value: null, ratio: null, direction: "flat" };
  }
  const ratio = ((current - previous) / previous) * 100;
  return {
    value: current - previous,
    ratio,
    direction: Math.abs(ratio) < 0.05 ? "flat" : ratio > 0 ? "up" : "down",
  };
}

/** 迷你趋势：返回 0-1 之间的归一化点 */
export function sparkline(list: { date: string; totals: Totals }[], key: keyof Totals): number[] {
  const values = list.map((item) => item.totals[key]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

/* ------------------------------------------------------------------ */
/* 未来 3-7 天预测：确定性基线 + 情景 + 建议                            */
/* ------------------------------------------------------------------ */

export type ForecastConfidence = "high" | "medium" | "low";
export type ForecastActionKey = "increase" | "decrease" | "pause" | "observe" | "refresh_creative";

export interface ForecastScenario {
  key: string;
  label: string;
  deltaPct: number;
  cost: number;
  revenue: number;
  orders: number;
  roi: number | null;
  netRevenue: number | null;
  netRoi: number | null;
  revenueDelta: number;
  roiDelta: number | null;
}

export interface PlanForecast {
  planId: string;
  planName: string;
  horizonDays: number;
  generatedAt: string;
  history: { start: string; end: string; days: number };
  baseline: {
    cost: number;
    revenue: number;
    orders: number;
    roi: number | null;
    cpa: number | null;
    netRevenue: number | null;
    netRoi: number | null;
    refundRate: number | null;
    daily: {
      date: string;
      cost: number;
      revenue: number;
      orders: number;
      roi: number | null;
      netRoi: number | null;
    }[];
  };
  trend: { direction: "up" | "down" | "flat"; roiChangePct: number | null; costChangePct: number | null };
  range: { roiLow: number | null; roiHigh: number | null; revenueLow: number; revenueHigh: number };
  confidence: ForecastConfidence;
  confidenceReason: string;
  scenarios: ForecastScenario[];
  recommendation: {
    action: ForecastActionKey;
    label: string;
    deltaPct: number | null;
    reason: string;
    expectedRoi: [number | null, number | null];
    expectedRevenue: [number, number];
    checkpoints: string[];
    rollback: string;
  };
  creativeSignals: {
    activeCount: number;
    topShare: number;
    topAgeDays: number;
    refundHeavyShare: number;
    rejectedCount: number;
    signals: string[];
  };
  dataGaps: string[];
}

const FORECAST_ACTION_LABELS: Record<ForecastActionKey, string> = {
  increase: "加预算 10%",
  decrease: "降预算 10%",
  pause: "暂停",
  observe: "只观察",
  refresh_creative: "换素材（先观察）",
};

function sumWindow(points: DailyPoint[]) {
  const totals = { cost: 0, revenue: 0, orders: 0, show: 0, click: 0, netRevenue: 0 };
  let hasNet = false;
  for (const point of points) {
    totals.cost += point.cost;
    totals.revenue += point.revenue;
    totals.orders += point.orders;
    totals.show += point.show;
    totals.click += point.click;
    if (point.netRevenue != null) {
      totals.netRevenue += point.netRevenue;
      hasNet = true;
    }
  }
  return { ...totals, hasNet };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100;
}

export function forecastPlan(
  plan: Campaign,
  range: DateRange,
  options: { horizonDays?: number; targetRoi?: number } = {},
): PlanForecast {
  const horizonDays = Math.min(7, Math.max(3, Math.round(options.horizonDays ?? 7)));
  const endIndex = dayIndexOf(range.end);
  const recent = plan.daily.slice(Math.max(0, endIndex - 6), endIndex + 1);
  const prior = plan.daily.slice(Math.max(0, endIndex - 13), Math.max(0, endIndex - 6));
  const recentTotals = sumWindow(recent);
  const priorTotals = sumWindow(prior);
  const roiRecent = recentTotals.cost > 0 ? recentTotals.revenue / recentTotals.cost : null;
  const roiPrior = priorTotals.cost > 0 ? priorTotals.revenue / priorTotals.cost : null;
  const roiChangePct = roiRecent != null && roiPrior != null && roiPrior > 0 ? ((roiRecent - roiPrior) / roiPrior) * 100 : null;
  const costChangePct = priorTotals.cost > 0 ? ((recentTotals.cost - priorTotals.cost) / priorTotals.cost) * 100 : null;
  const direction: PlanForecast["trend"]["direction"] =
    roiChangePct == null ? "flat" : Math.abs(roiChangePct) < 3 ? "flat" : roiChangePct > 0 ? "up" : "down";
  const account = accountById(plan.accountId);
  const netAvailable = Boolean(account?.dataSources.includes("商品交易")) && recentTotals.hasNet;
  const refundRate = netAvailable && recentTotals.revenue > 0 ? (recentTotals.revenue - recentTotals.netRevenue) / recentTotals.revenue : null;
  const aov = recentTotals.orders > 0 ? recentTotals.revenue / recentTotals.orders : 0;
  const avgDailyCost = recentTotals.cost / Math.max(1, recent.length);
  const projectedRoi =
    roiRecent == null ? null : Math.max(0.1, roiRecent * (1 + clamp(((roiChangePct ?? 0) / 100) * 0.4, -0.12, 0.12)));
  const avgDailyRevenue = projectedRoi == null ? 0 : avgDailyCost * projectedRoi;
  const avgDailyOrders = aov > 0 ? avgDailyRevenue / aov : 0;
  const horizonCost = Math.round(avgDailyCost * horizonDays);
  const horizonRevenue = Math.round(avgDailyRevenue * horizonDays);
  const horizonOrders = Math.round(avgDailyOrders * horizonDays);
  const horizonNetRevenue = netAvailable && refundRate != null ? Math.round(horizonRevenue * (1 - refundRate)) : null;

  const creatives = plan.creativeIds
    .map((id) => creativeById(id))
    .filter((creative): creative is Creative => Boolean(creative));
  const recentRange = { start: recent[0]?.date ?? range.start, end: range.end };
  const creativeRows = creatives.map((creative) => ({ creative, metrics: creativeMetrics(creative, recentRange) }));
  const activeRows = creativeRows.filter((row) => row.creative.auditStatus === "通过" && row.metrics.cost > 0);
  const creativeCost = creativeRows.reduce((sum, row) => sum + row.metrics.cost, 0);
  const topCreative = [...creativeRows].sort((left, right) => right.metrics.cost - left.metrics.cost)[0];
  const topShare = creativeCost > 0 ? (topCreative?.metrics.cost ?? 0) / creativeCost : 0;
  const topAgeDays = topCreative
    ? Math.max(0, endIndex - dayIndexOf(topCreative.creative.createdAt.slice(0, 10)))
    : 0;
  const refundHeavyCost = creativeRows
    .filter((row) => row.metrics.refundRate != null && row.metrics.refundRate > 15)
    .reduce((sum, row) => sum + row.metrics.cost, 0);
  const refundHeavyShare = creativeCost > 0 ? refundHeavyCost / creativeCost : 0;
  const rejectedCount = creatives.filter((creative) => creative.auditStatus === "拒绝").length;
  const signals: string[] = [];
  if (activeRows.length <= 1) signals.push("只有 1 条在投素材");
  if (topShare > 0.6 && topAgeDays > 14) signals.push(`Top 素材占 ${(topShare * 100).toFixed(0)}%、已投 ${topAgeDays} 天，准备替补`);
  if (refundHeavyShare > 0.4) signals.push(`退款重素材占消耗 ${(refundHeavyShare * 100).toFixed(0)}%`);
  if (rejectedCount > 0) signals.push(`${rejectedCount} 条素材被拒审`);

  const dataGaps: string[] = [];
  if (!account) dataGaps.push("账户不存在");
  if (account && account.authorization !== "已授权") dataGaps.push(`账户授权不完整（${account.authorization}）`);
  if (account && !account.dataSources.includes("商品交易")) dataGaps.push("净成交/退款不可用");
  if ((account?.dataLagMinutes ?? 0) > 10) dataGaps.push(`报表延迟 ${account?.dataLagMinutes} 分钟`);
  if (recentTotals.orders < 30) dataGaps.push(`样本不足（近 7 天 ${recentTotals.orders} 单）`);
  if (activeRows.length === 0) dataGaps.push("没有过审且在投的素材");

  const orderCount = recentTotals.orders;
  const confidence: ForecastConfidence =
    orderCount >= 70 && netAvailable && (account?.dataLagMinutes ?? 0) <= 10 && activeRows.length >= 2
      ? "high"
      : orderCount >= 30 && netAvailable
        ? "medium"
        : "low";
  const uncertainty = confidence === "high" ? 0.08 : confidence === "medium" ? 0.15 : 0.28;
  const confidenceReason =
    confidence === "high"
      ? "近 7 天样本充足，净成交可用，延迟正常"
      : confidence === "medium"
        ? "样本或数据完整度一般，给出区间"
        : `样本/数据不足：近 7 天 ${orderCount} 单${netAvailable ? "" : "，净成交不可用"}`;

  const elasticity = (delta: number) => (delta > 0 ? 0.55 : 0.8);
  const scenarioFor = (key: string, label: string, deltaPct: number): ForecastScenario => {
    if (deltaPct === 0 && key === "pause") {
      return { key, label, deltaPct, cost: 0, revenue: 0, orders: 0, roi: null, netRevenue: 0, netRoi: null, revenueDelta: -horizonRevenue, roiDelta: null };
    }
    const cost = Math.round(horizonCost * (1 + deltaPct / 100));
    const revenue = Math.round(horizonRevenue * (1 + (deltaPct / 100) * elasticity(deltaPct)));
    const orders = Math.round(horizonOrders * (1 + (deltaPct / 100) * elasticity(deltaPct)));
    const netRevenue = netAvailable && refundRate != null ? Math.round(revenue * (1 - refundRate)) : null;
    const roi = cost > 0 ? revenue / cost : null;
    return {
      key,
      label,
      deltaPct,
      cost,
      revenue,
      orders,
      roi: round2(roi),
      netRevenue,
      netRoi: netRevenue != null && cost > 0 ? round2(netRevenue / cost) : null,
      revenueDelta: revenue - horizonRevenue,
      roiDelta: roi != null && roiRecent != null ? round2(roi - roiRecent) : null,
    };
  };
  const scenarios = [
    scenarioFor("base", "不调整", 0),
    scenarioFor("increase_10", "加预算 10%", 10),
    scenarioFor("decrease_10", "降预算 10%", -10),
    scenarioFor("pause", "暂停", 0),
  ];

  const goal = options.targetRoi ?? plan.roiGoal ?? 3.5;
  const product = PRODUCT_BY_ID.get(plan.productId);
  const stockDays =
    product && recentTotals.orders > 0 ? product.stock / (recentTotals.orders / Math.max(1, recent.length)) : null;
  const budgetUtilization = plan.budget > 0 ? avgDailyCost / plan.budget : null;
  const netCaveat = netAvailable ? "" : "净成交不可用，按支付 ROI 判断；";
  let action: ForecastActionKey = "observe";
  let reason = "数据没有给出明确方向，先观察";
  if (plan.status !== "投放中") {
    action = "observe";
    reason = `计划当前为「${plan.status}」，先确认状态`;
  } else if (recentTotals.cost <= 0) {
    action = "observe";
    reason = "近 7 天没有消耗，先确认计划是否在投";
  } else if (orderCount < 30) {
    action = "observe";
    reason = `近 7 天只有 ${orderCount} 单，样本不足，先扩样本`;
  } else if (stockDays != null && stockDays < 7) {
    action = "observe";
    reason = `库存只够 ${stockDays.toFixed(1)} 天，先补货`;
  } else if (projectedRoi != null && projectedRoi < Math.max(1, goal * 0.6) && (refundRate ?? 0) > 0.2) {
    action = "pause";
    reason = `预测 ROI ${projectedRoi.toFixed(2)} 已明显跌破目标，退款率 ${((refundRate ?? 0) * 100).toFixed(1)}%，先止损`;
  } else if (projectedRoi != null && (projectedRoi < goal * 0.97 || (refundRate ?? 0) > 0.18)) {
    if ((topShare > 0.6 && topAgeDays > 14) || refundHeavyShare > 0.4) {
      action = "refresh_creative";
      reason = `效率偏低且素材集中在${refundHeavyShare > 0.4 ? "高退款" : "老化"}素材上，先换素材`;
    } else {
      action = "decrease";
      reason = `预测 ROI ${projectedRoi.toFixed(2)} 低于目标 ${goal.toFixed(2)}${refundRate != null ? `，退款率 ${(refundRate * 100).toFixed(1)}%` : ""}`;
    }
  } else if (
    projectedRoi != null &&
    projectedRoi >= goal &&
    budgetUtilization != null &&
    budgetUtilization >= 0.85 &&
    (stockDays == null || stockDays >= 7)
  ) {
    action = "increase";
    reason = `预测 ROI ${projectedRoi.toFixed(2)} 达标，预算利用率 ${(budgetUtilization * 100).toFixed(0)}%，库存可承接`;
  } else {
    action = "observe";
    reason = `预测 ROI ${projectedRoi?.toFixed(2) ?? "--"}，没有足够把握加或减`;
  }
  if (action !== "observe") reason = `${netCaveat}${reason}`;

  const chosen =
    action === "increase"
      ? scenarios.find((item) => item.key === "increase_10") ?? scenarios[0]
      : action === "decrease"
        ? scenarios.find((item) => item.key === "decrease_10") ?? scenarios[0]
        : action === "pause"
          ? scenarios.find((item) => item.key === "pause") ?? scenarios[0]
          : scenarios[0];
  const expectedRoi: [number | null, number | null] = [
    chosen.roi == null ? null : round2(chosen.roi * (1 - uncertainty)),
    chosen.roi == null ? null : round2(chosen.roi * (1 + uncertainty)),
  ];
  const expectedRevenue: [number, number] = [
    Math.round(chosen.revenue * (1 - uncertainty)),
    Math.round(chosen.revenue * (1 + uncertainty)),
  ];
  const metricLabel = netAvailable ? "净 ROI" : "支付 ROI";
  const baseMetric =
    netAvailable && horizonCost > 0 && horizonNetRevenue != null ? horizonNetRevenue / horizonCost : projectedRoi;
  const metricFloor = baseMetric != null ? baseMetric * 0.9 : goal * 0.8;
  const checkpoints = [
    `3 天后：${metricLabel} ≥ ${metricFloor.toFixed(1)}（当前 ${baseMetric?.toFixed(2) ?? "--"}），订单成本 ≤ ${Math.round((chosen.cost / Math.max(1, chosen.orders)) * 1.1)} 元`,
    refundRate == null ? "退款率暂不可用，补齐授权后复核" : `退款率 ≤ ${(Math.max(0.15, refundRate + 0.03) * 100).toFixed(1)}%`,
  ];
  if (action === "increase") checkpoints.push("库存可售天数 ≥ 7 天");
  if (action === "refresh_creative") checkpoints.push("新素材过审后先跑 2–3 天再评估");
  const rollback = `若 3 天内${metricLabel} 跌破 ${(baseMetric != null ? baseMetric * 0.85 : goal * 0.8).toFixed(
    1,
  )} 或退款率超过 ${(Math.max(0.18, (refundRate ?? 0.15) + 0.05) * 100).toFixed(1)}%，撤回到当前预算/出价/素材。`;

  const generatedAt = new Date().toISOString();
  return {
    planId: plan.id,
    planName: plan.name,
    horizonDays,
    generatedAt,
    history: {
      start: recent[0]?.date ?? range.start,
      end: range.end,
      days: recent.length,
    },
    baseline: {
      cost: horizonCost,
      revenue: horizonRevenue,
      orders: horizonOrders,
      roi: round2(projectedRoi),
      cpa: horizonOrders > 0 ? round2(horizonCost / horizonOrders) : null,
      netRevenue: horizonNetRevenue,
      netRoi: horizonNetRevenue != null && horizonCost > 0 ? round2(horizonNetRevenue / horizonCost) : null,
      refundRate: refundRate == null ? null : round2(refundRate * 100),
      daily: Array.from({ length: horizonDays }, (_, index) => {
        const date = toDateKey(addDays(parseDateKey(range.end), index + 1));
        const revenue = Math.round(avgDailyRevenue);
        const net = netAvailable && refundRate != null ? Math.round(revenue * (1 - refundRate)) : null;
        return {
          date,
          cost: Math.round(avgDailyCost),
          revenue,
          orders: Math.round(avgDailyOrders),
          roi: round2(projectedRoi),
          netRoi: net != null && avgDailyCost > 0 ? round2(net / avgDailyCost) : null,
        };
      }),
    },
    trend: { direction, roiChangePct: round2(roiChangePct), costChangePct: round2(costChangePct) },
    range: {
      roiLow: projectedRoi == null ? null : round2(projectedRoi * (1 - uncertainty)),
      roiHigh: projectedRoi == null ? null : round2(projectedRoi * (1 + uncertainty)),
      revenueLow: Math.round(horizonRevenue * (1 - uncertainty)),
      revenueHigh: Math.round(horizonRevenue * (1 + uncertainty)),
    },
    confidence,
    confidenceReason,
    scenarios,
    recommendation: {
      action,
      label: FORECAST_ACTION_LABELS[action],
      deltaPct: action === "increase" ? 10 : action === "decrease" ? -10 : null,
      reason,
      expectedRoi,
      expectedRevenue,
      checkpoints,
      rollback,
    },
    creativeSignals: {
      activeCount: activeRows.length,
      topShare: Math.round(topShare * 100) / 100,
      topAgeDays,
      refundHeavyShare: Math.round(refundHeavyShare * 100) / 100,
      rejectedCount,
      signals,
    },
    dataGaps,
  };
}
