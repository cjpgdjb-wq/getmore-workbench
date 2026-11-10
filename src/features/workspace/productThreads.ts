import {
  ACCOUNTS,
  BRAND_CAMPAIGNS,
  CAMPAIGNS,
  PRODUCTS,
  TODAY,
  addDays,
  cpaOf,
  creativeById,
  creativeMetrics,
  cpmOf,
  ctrOf,
  dailyTotals,
  dataHealthOf,
  forecastPlan,
  netTotalsOf,
  orgById,
  roiOf,
  sumSeries,
  toDateKey,
  type Account,
  type Campaign,
  type Creative,
  type DateRange,
  type Product,
} from "../../data/mock";
import type { AdOperation } from "../../lib/partner";
import type { Role } from "../../state/workbench";
import { DEFAULT_SKILL_IDS, DEFAULT_TOOL_IDS, SHARED_SKILLS, skillById, toolById } from "./assistantRegistry";

export type ThreadPermission = "read" | "suggest";

export interface ProductThread {
  id: string;
  productId: string;
  accountId: string;
  orgId: string;
  title: string;
  createdBy: Role;
  createdAt: string;
  permission: ThreadPermission;
  /** 从共享工具池绑定的工具 */
  toolIds: string[];
  /** 从共享技能池绑定的技能 */
  skillIds: string[];
}

export interface ProductWorkspace extends ProductThread {
  status: "active" | "archived";
}

export interface ProductScope {
  thread: ProductThread;
  product: Product;
  account: Account;
  orgName: string;
  campaigns: Campaign[];
  range: DateRange;
}

const STORAGE_KEY = "getmore.product-threads.v1";

export function loadProductThreads(): ProductThread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProductThread[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item?.id && item?.productId)
      .map((item) => ({
        ...item,
        permission: item.permission === "read" ? "read" : "suggest",
        toolIds: Array.isArray(item.toolIds) ? item.toolIds : DEFAULT_TOOL_IDS,
        skillIds: Array.isArray(item.skillIds) ? item.skillIds : DEFAULT_SKILL_IDS,
      }));
  } catch {
    return [];
  }
}

export function saveProductThreads(threads: ProductThread[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  } catch {
    /* storage unavailable */
  }
}

export function threadForProduct(threads: ProductThread[], productId: string): ProductThread | undefined {
  return threads.find((thread) => thread.productId === productId);
}

export function getProductScope(productId: string, thread: ProductThread): ProductScope | null {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (!product) return null;
  const account = ACCOUNTS.find((item) => item.id === product.accountId);
  if (!account) return null;
  const campaigns = [...CAMPAIGNS, ...BRAND_CAMPAIGNS].filter((campaign) => campaign.productId === productId);
  if (campaigns.length === 0) return null;
  return {
    thread,
    product,
    account,
    orgName: orgById(account.orgId)?.name ?? account.orgId,
    campaigns,
    range: { start: toDateKey(addDays(TODAY, -6)), end: toDateKey(TODAY) },
  };
}

export function getProductScopeForThread(thread: ProductThread): ProductScope | null {
  return getProductScope(thread.productId, thread);
}

function applyOperationPatches(scope: ProductScope, operations: AdOperation[]): ProductScope {
  const ordered = [...operations].sort((a, b) => a.at - b.at);
  const planIds = new Set(scope.campaigns.map((campaign) => campaign.id));
  const accountOps = ordered.filter(
    (operation) => !operation.undone && operation.target_type === "account" && operation.target_id === scope.account.id,
  );
  const planOps = ordered.filter(
    (operation) => !operation.undone && operation.target_type === "plan" && planIds.has(operation.target_id),
  );
  const accountPatch: Partial<Pick<Account, "status" | "budget">> = {};
  for (const operation of accountOps) {
    if (operation.field === "status") accountPatch.status = operation.after as Account["status"];
    if (operation.field === "budget") accountPatch.budget = Number(operation.after);
  }
  const planPatch = new Map<string, Partial<Pick<Campaign, "status" | "budget" | "bid">>>();
  for (const operation of planOps) {
    const patch = planPatch.get(operation.target_id) ?? {};
    if (operation.field === "status") patch.status = operation.after as Campaign["status"];
    if (operation.field === "budget") patch.budget = Number(operation.after);
    if (operation.field === "bid") patch.bid = Number(operation.after);
    planPatch.set(operation.target_id, patch);
  }
  return {
    ...scope,
    account: { ...scope.account, ...accountPatch },
    campaigns: scope.campaigns.map((campaign) => ({ ...campaign, ...(planPatch.get(campaign.id) ?? {}) })),
  };
}

export function buildProductContext(
  rawScope: ProductScope,
  operations: AdOperation[],
  role: Role,
  summary?: string,
): string {
  const scope = applyOperationPatches(rawScope, operations);
  const { product, account, campaigns, range, thread } = scope;
  const health = dataHealthOf(account);
  const isBrand = account.channel === "brand";
  const totals = campaigns.reduce(
    (acc, campaign) => {
      const value = sumSeries(campaign.daily, range);
      acc.cost += value.cost;
      acc.revenue += value.revenue;
      acc.orders += value.orders;
      acc.show += value.show;
      acc.click += value.click;
      acc.netRevenue += netTotalsOf(campaign.daily.filter((point) => point.date >= range.start && point.date <= range.end)).netRevenue ?? 0;
      acc.hasNet ||= netTotalsOf(campaign.daily.filter((point) => point.date >= range.start && point.date <= range.end)).netRevenue !== null;
      return acc;
    },
    { cost: 0, revenue: 0, orders: 0, show: 0, click: 0, netRevenue: 0, hasNet: false },
  );
  const roi = roiOf(totals);
  const lines = [
    "[智能助手上下文 | 本地模拟数据]",
    `助手：${thread.title}（${thread.id}）`,
    `范围：${scope.orgName} / ${account.name} / ${product.name}`,
    `助手创建人：${thread.createdBy === "operator" ? "优化师" : "产品经理"}；当前使用者视角：${role === "operator" ? "优化师" : "产品经理"}`,
    `权限：${thread.permission === "read" ? "只读分析，不能提交执行提案" : "分析 + 建议；可提交执行提案，优化师确认后由系统执行"}`,
    `执行边界：你不能自行直接修改投放，也不能声称“已调整”；你可以在对话里提交“执行提案”，由优化师确认后执行。`,
    `统计周期：${range.start} ~ ${range.end}（近 7 天）`,
    `商品：${product.name}；价格 ¥${product.price.toFixed(2)}；库存 ${product.stock}；状态 ${product.status}`,
    `账户：${account.name}（ID: ${account.id}）；状态 ${account.status}；日预算 ¥${account.budget.toFixed(2)}；余额 ¥${account.balance.toFixed(2)}；授权 ${account.authorization}`,
    `计划数：${campaigns.length}`,
    `范围规则：本对话只负责该商品的 ${campaigns.length} 条计划；不得查询、分析或操作其他商品/账户；跨商品需求请新建对应商品的助手。`,
    `数据口径：${isBrand ? "品牌广告看消耗 / 展示 / CPM / 点击 / CTR，无支付 ROI" : "支付 ROI = 支付金额 / 消耗；订单成本 = 消耗 / 订单数；净成交数据仅授权账户可用"}。`,
    `数据健康：最近同步 ${health.lastSyncedAt}；延迟 ${health.lagMinutes} 分钟；完整度 ${(health.completeness * 100).toFixed(0)}%；缺失 ${health.missing.join("、") || "无"}；延迟账户 ${health.stale.length > 0 ? "是" : "否"}。`,
    "绝对盈亏：不可判断。千川不提供商品成本、毛利、物流、退货；只能评价投放效率、目标达成和相对变化。",
  ];
  const enabledSkills = SHARED_SKILLS.filter((skill) => thread.skillIds.includes(skill.id));
  if (enabledSkills.length) {
    lines.push(`启用技能（共享池）：${enabledSkills.map((skill) => skill.name).join("、")}`);
    for (const skill of enabledSkills.slice(0, 4)) {
      const instruction = skill.instructions.length > 180 ? `${skill.instructions.slice(0, 180)}…` : skill.instructions;
      lines.push(`- ${skill.name}：${instruction}`);
    }
  }
  const enabledTools = thread.toolIds.map((id) => toolById(id)?.name).filter(Boolean);
  if (enabledTools.length) {
    lines.push(`已绑定分析工具（共享池，只读）：${enabledTools.join("、")}`);
  }
  if (thread.permission !== "read") {
    lines.push(
      "执行提案能力：可以提交账户日预算、计划出价、暂停/恢复计划；每轮最多 2 个动作；高风险需优化师勾选确认；不支持新建/复刻计划。",
    );
    lines.push(
      "回答“能不能直接调”时：不能直接调，但可以提交执行提案，优化师确认后执行；不要说“只能去千川后台自己点”。",
    );
    lines.push("当用户明确要求执行时：提交提案，不要只给建议；没有具体账户/计划/幅度时先问清楚。");
    lines.push("执行提案卡片由系统在回答后异步生成；回答时说“将生成执行提案，请留意下方卡片”，不要声称卡片已经生成，也不要让用户回复“确认执行”。");
  }
  if (summary) lines.push(`上一段会话摘要：${summary.slice(0, 700)}`);
  lines.push("当前汇总：");
  if (isBrand) {
    lines.push(
      `- 消耗 ¥${totals.cost.toFixed(2)}；展示 ${totals.show}；CPM ¥${cpmOf(totals)?.toFixed(2) ?? "--"}；点击 ${totals.click}；CTR ${ctrOf(totals)?.toFixed(2) ?? "--"}%`,
    );
  } else {
    lines.push(
      `- 消耗 ¥${totals.cost.toFixed(2)}；支付 ¥${totals.revenue.toFixed(2)}；订单 ${totals.orders}；ROI ${roi?.toFixed(2) ?? "--"}；订单成本 ¥${cpaOf(totals)?.toFixed(2) ?? "--"}`,
    );
    lines.push(
      `- 净成交：${totals.hasNet ? `¥${totals.netRevenue.toFixed(2)}` : "未同步（部分账户缺商品交易授权）"}；净成交 ROI：${totals.hasNet && totals.cost > 0 ? (totals.netRevenue / totals.cost).toFixed(2) : "--"}`,
    );
  }
  const trend = dailyTotals(campaigns.map((campaign) => campaign.daily), range);
  const trendText = trend
    .map((day) => {
      if (isBrand) return `${day.date.slice(5)} ${ctrOf(day.totals)?.toFixed(2) ?? "--"}%`;
      return `${day.date.slice(5)} ${roiOf(day.totals)?.toFixed(2) ?? "--"}`;
    })
    .join(" → ");
  lines.push(`近7天${isBrand ? "CTR" : "ROI"}走势：${trendText}`);
  lines.push("计划明细：");
  for (const campaign of campaigns) {
    const metric = sumSeries(campaign.daily, range);
    const campaignRoi = roiOf(metric);
    const flags = [
      campaign.status,
      campaign.learningPhase,
      campaign.rejectReason ? `审核：${campaign.rejectReason}` : "",
    ].filter(Boolean);
    lines.push(
      `- ${campaign.name}（plan_id: ${campaign.id}）${campaign.mode} · ${campaign.target}${campaign.brandPlacement ? ` · ${campaign.brandPlacement}` : ""}；${flags.join("；")}；预算 ¥${campaign.budget.toFixed(2)}；出价 ¥${campaign.bid.toFixed(2)}；消耗 ¥${metric.cost.toFixed(2)}；${
        isBrand
          ? `展示 ${metric.show}；点击 ${metric.click}；CTR ${ctrOf(metric)?.toFixed(2) ?? "--"}%`
          : `支付 ¥${metric.revenue.toFixed(2)}；订单 ${metric.orders}；ROI ${campaignRoi?.toFixed(2) ?? "--"}；订单成本 ¥${cpaOf(metric)?.toFixed(2) ?? "--"}`
      }`,
    );
    const creatives = campaign.creativeIds
      .map((id) => creativeById(id))
      .filter((creative): creative is Creative => Boolean(creative));
    if (creatives.length) {
      const rows = creatives
        .map((creative) => ({ creative, metrics: creativeMetrics(creative, range) }))
        .sort((left, right) => right.metrics.cost - left.metrics.cost);
      const top = rows[0];
      const passed = creatives.filter((creative) => creative.auditStatus === "通过").length;
      const rejected = creatives.filter((creative) => creative.auditStatus === "拒绝").length;
      const topLine = isBrand
        ? `展示 ${top.metrics.show} / CTR ${top.metrics.ctr?.toFixed(2) ?? "--"}%`
        : `消耗 ¥${top.metrics.cost.toFixed(0)} / ROI ${top.metrics.roi?.toFixed(2) ?? "--"} / CTR ${top.metrics.ctr?.toFixed(2) ?? "--"}% / CVR ${top.metrics.cvr?.toFixed(2) ?? "--"}%${
            top.metrics.completion5s == null ? "" : ` / 5s完播 ${(top.metrics.completion5s * 100).toFixed(0)}%`
          }${top.metrics.refundRate == null ? "" : ` / 退款率 ${top.metrics.refundRate.toFixed(1)}%`}`;
      lines.push(
        `  素材：${creatives.length} 条（通过 ${passed} / 拒绝 ${rejected}）；Top 消耗「${top.creative.title}」${topLine}`,
      );
    }
    if (campaign.channel === "auction") {
      const forecast = forecastPlan(campaign, range);
      lines.push(
        `  未来7天：ROI ${forecast.range.roiLow?.toFixed(2) ?? "--"}–${forecast.range.roiHigh?.toFixed(2) ?? "--"}（置信度 ${forecast.confidence}）；建议 ${forecast.recommendation.label}；${forecast.recommendation.checkpoints[0] ?? ""}`,
      );
    }
  }
  const relevantOps = operations.filter(
    (operation) =>
      !operation.undone &&
      (operation.target_id === account.id || campaigns.some((campaign) => campaign.id === operation.target_id)),
  );
  if (relevantOps.length) {
    lines.push("最近操作：");
    for (const operation of relevantOps.slice(0, 5)) {
      lines.push(
        `- ${operation.target_name}：${operation.field} ${operation.before} → ${operation.after}（${operation.reason}）`,
      );
    }
  }
  lines.push(
    isBrand
      ? "回答边界：品牌广告没有支付归因；不要用 ROI 评价品牌，不要判断盈亏。"
      : "回答边界：不要判断绝对盈亏；缺净成交时只做支付口径的相对判断。",
  );
  return lines.join("\n");
}
