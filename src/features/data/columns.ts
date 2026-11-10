import type { Channel, Dimension } from "../../data/mock";

export type ColumnGroupId = "attr" | "finance" | "perf";

export const COLUMN_GROUPS: Record<ColumnGroupId, string> = {
  attr: "属性设置",
  finance: "财务指标",
  perf: "基础效果",
};

export interface ColumnMeta {
  id: string;
  label: string;
  sub?: string;
  align: "left" | "right";
  sortable?: boolean;
  width?: number;
  group: ColumnGroupId;
  /** 自定义列面板中默认勾选 */
  defaultVisible?: boolean;
}

const AUCTION_ACCOUNT_COLUMNS: ColumnMeta[] = [
  { id: "balance", label: "总余额", align: "right", group: "finance", width: 78, sortable: true, defaultVisible: true },
  { id: "bidBalance", label: "竞价总可用余额", align: "right", group: "finance", width: 118, sortable: true, defaultVisible: false },
  { id: "cost", label: "消耗", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "roi", label: "ROI", align: "right", group: "perf", width: 68, sortable: true, defaultVisible: true },
  { id: "payAmount", label: "支付金额", align: "right", group: "perf", width: 84, sortable: true, defaultVisible: true },
  { id: "orders", label: "订单数", align: "right", group: "perf", width: 68, sortable: true, defaultVisible: true },
  { id: "cpa", label: "订单成本", align: "right", group: "perf", width: 80, sortable: true, defaultVisible: true },
  { id: "role", label: "我的角色", align: "left", group: "attr", width: 80, defaultVisible: true },
  { id: "status", label: "状态", align: "left", group: "attr", width: 72, defaultVisible: true },
  { id: "budget", label: "日预算", align: "right", group: "attr", width: 78, sortable: true, defaultVisible: true },
  { id: "org", label: "归属组织", align: "left", group: "attr", width: 120, defaultVisible: true },
  { id: "remark", label: "备注", align: "left", group: "attr", width: 130, defaultVisible: true },
];

const BRAND_ACCOUNT_COLUMNS: ColumnMeta[] = [
  { id: "balance", label: "总余额", align: "right", group: "finance", width: 78, sortable: true, defaultVisible: true },
  { id: "cost", label: "消耗", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "shows", label: "展示", align: "right", group: "perf", width: 88, sortable: true, defaultVisible: true },
  { id: "cpm", label: "千次展现", align: "right", group: "perf", width: 96, sortable: true, defaultVisible: true },
  { id: "clicks", label: "点击", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "ctr", label: "点击率", align: "right", group: "perf", width: 76, sortable: true, defaultVisible: true },
  { id: "status", label: "状态", align: "left", group: "attr", width: 72, defaultVisible: true },
  { id: "budget", label: "日预算", align: "right", group: "attr", width: 80, sortable: true, defaultVisible: true },
  { id: "org", label: "归属组织", align: "left", group: "attr", width: 120, defaultVisible: true },
  { id: "remark", label: "备注", align: "left", group: "attr", width: 130, defaultVisible: true },
];

const CAMPAIGN_COLUMNS: ColumnMeta[] = [
  { id: "cost", label: "消耗", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "orders", label: "订单数", align: "right", group: "perf", width: 68, sortable: true, defaultVisible: true },
  { id: "payAmount", label: "支付金额", align: "right", group: "perf", width: 84, sortable: true, defaultVisible: true },
  { id: "roi", label: "ROI", align: "right", group: "perf", width: 68, sortable: true, defaultVisible: true },
  { id: "cpa", label: "订单成本", align: "right", group: "perf", width: 80, sortable: true, defaultVisible: true },
  { id: "product", label: "商品", align: "left", group: "attr", width: 140, defaultVisible: true },
  { id: "douyin", label: "抖音号", align: "left", group: "attr", width: 104, defaultVisible: true },
  { id: "account", label: "关联账户", align: "left", group: "attr", width: 124, defaultVisible: true },
  { id: "budget", label: "日预算", align: "right", group: "attr", width: 78, sortable: true, defaultVisible: true },
  { id: "bid", label: "出价", align: "right", group: "attr", width: 72, sortable: true, defaultVisible: true },
  { id: "status", label: "投放状态", align: "left", group: "attr", width: 80, defaultVisible: true },
];

const BRAND_CAMPAIGN_COLUMNS: ColumnMeta[] = [
  { id: "cost", label: "消耗", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "shows", label: "展示", align: "right", group: "perf", width: 88, sortable: true, defaultVisible: true },
  { id: "clicks", label: "点击", align: "right", group: "perf", width: 78, sortable: true, defaultVisible: true },
  { id: "ctr", label: "点击率", align: "right", group: "perf", width: 76, sortable: true, defaultVisible: true },
  { id: "cpm", label: "千次展现", align: "right", group: "perf", width: 96, sortable: true, defaultVisible: true },
  { id: "account", label: "关联账户", align: "left", group: "attr", width: 140, defaultVisible: true },
  { id: "budget", label: "预算", align: "right", group: "attr", width: 80, sortable: true, defaultVisible: true },
  { id: "douyin", label: "抖音号", align: "left", group: "attr", width: 98, defaultVisible: true },
  { id: "status", label: "投放状态", align: "left", group: "attr", width: 80, defaultVisible: true },
];

export function getColumns(channel: Channel, dimension: Dimension): ColumnMeta[] {
  if (dimension === "campaign") {
    return channel === "auction" ? CAMPAIGN_COLUMNS : BRAND_CAMPAIGN_COLUMNS;
  }
  return channel === "auction" ? AUCTION_ACCOUNT_COLUMNS : BRAND_ACCOUNT_COLUMNS;
}

export function columnConfigKey(channel: Channel, dimension: Dimension): string {
  // v4: 恢复全部字段，允许横向滚动；后续再规划列优先级
  return `${channel}:${dimension}:v4`;
}

export function defaultColumnIds(channel: Channel, dimension: Dimension): string[] {
  return getColumns(channel, dimension)
    .filter((column) => column.defaultVisible)
    .map((column) => column.id);
}

export function findColumn(channel: Channel, dimension: Dimension, id: string): ColumnMeta | undefined {
  return getColumns(channel, dimension).find((column) => column.id === id);
}
