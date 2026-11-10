/**
 * 策略实验：优化师视角的「小实验」。
 *
 * 和 hypotheses.mjs 的区别：
 * - hypotheses 是研究/回放引擎，回答“这个策略是否值得验证”；
 * - experiments 是执行/复盘对象，回答“在这个账户/计划上，今天试什么、怎么试、试完怎么办”。
 *
 * 一个实验必须：
 * - 绑定账户/计划；
 * - 有具体动作、成本上限、观察窗口、判断标准；
 * - 开始 = 生成 Decision（走现有 HITL），不是直接改投放；
 * - 有进行中/待复盘/已结论/已回滚的生命周期。
 *
 * 本模块是 Phase 1：推荐、开始、复盘、回滚；复盘为确定性模拟数据，界面会标注「演示」。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "./mock.mjs";
import { decorateMock, getOperation, listOperations, undoOperation } from "./operations.mjs";
import { createDecision, getDecision, rejectDecision } from "./decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "experiments.json");

const TEMPLATE_LABEL = {
  learning_phase: "学习期",
  budget_cap: "预算撞线",
  high_roi_low_spend: "高 ROI 低消耗",
  low_roi_high_spend: "低 ROI 高消耗",
  observe: "只观察",
};

const EFFECTS = {
  learning_phase: { roi: 0.27, gmv: -0.004, verdict: "positive", recommendation: "continue" },
  budget_cap: { roi: -0.05, gmv: 0.08, verdict: "positive", recommendation: "continue" },
  high_roi_low_spend: { roi: -0.08, gmv: 0.05, verdict: "positive", recommendation: "continue" },
  low_roi_high_spend: { roi: 0.2, gmv: -0.03, verdict: "positive", recommendation: "continue" },
  observe: { roi: 0, gmv: 0, verdict: "insufficient", recommendation: "observe" },
};

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand(key, index = 0) {
  let a = hash(`${key}#${index}`) >>> 0;
  a += 0x6d2b79f5;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function totals(series) {
  const cost = series.reduce((sum, point) => sum + (point.cost ?? 0), 0);
  if (cost <= 0) return null;
  const revenue = series.reduce((sum, point) => sum + (point.revenue ?? 0), 0);
  const orders = series.reduce((sum, point) => sum + (point.orders ?? 0), 0);
  return { cost, revenue, orders, roi: revenue / cost, cpa: orders > 0 ? cost / orders : null, days: series.length };
}

function last7(series) {
  return series.slice(-7);
}

function trendOf(series) {
  const last3 = totals(series.slice(-3));
  const prev3 = totals(series.slice(-6, -3));
  if (!last3 || !prev3) return { roi: 0, gmv: 0 };
  return {
    roi: last3.roi - prev3.roi,
    gmv: prev3.revenue > 0 ? last3.revenue / prev3.revenue - 1 : 0,
  };
}

function lastPoint(series) {
  return series[series.length - 1] ?? null;
}

function endOfDay(asOf) {
  return new Date(`${asOf}T23:59:59`).getTime();
}

function learningAt(plan, asOf) {
  if (!plan.learningStartedAt || plan.learningPhase !== "学习中") {
    return { phase: plan.learningPhase, days: plan.learningDays ?? 0 };
  }
  const start = plan.learningStartedAt.slice(0, 10);
  if (asOf < start) return { phase: "未进入", days: 0 };
  const end = new Date(`${start}T00:00:00`);
  end.setDate(end.getDate() + (plan.learningDays ?? 0));
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  if (asOf > endKey) return { phase: "已成长期", days: 0 };
  const days = Math.floor((new Date(`${asOf}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1;
  return { phase: "学习中", days };
}

/**
 * 历史回放专用：把 mock 世界切到 asOf 当天。
 * 只保留 asOf 之前的日序列；操作按 at/undo_at 判断当时是否生效。
 */
function mockAsOf(base, asOf) {
  if (!asOf) return decorateMock(base);
  const cutoff = endOfDay(asOf);
  const operations = listOperations({ includeUndone: true, limit: 2000 }).filter(
    (operation) =>
      operation.at <= cutoff &&
      (!operation.undone || (operation.undo_at && operation.undo_at > cutoff)),
  );
  const decorated = decorateMock(base, operations);
  const accounts = decorated.ACCOUNTS.map((account) => {
    const daily = account.daily.filter((point) => point.date <= asOf);
    return {
      ...account,
      daily,
      status: daily.slice(-7).some((point) => point.cost > 0) ? "投放中" : account.status,
    };
  });
  const campaigns = decorated.CAMPAIGNS.map((campaign) => {
    const learning = learningAt(campaign, asOf);
    const daily = campaign.daily.filter((point) => point.date <= asOf);
    return {
      ...campaign,
      daily,
      status: daily.slice(-7).some((point) => point.cost > 0) ? "投放中" : campaign.status,
      learningPhase: learning.phase,
      learningDays: learning.days,
    };
  });
  const brandCampaigns = decorated.BRAND_CAMPAIGNS.map((campaign) => ({
    ...campaign,
    daily: campaign.daily.filter((point) => point.date <= asOf),
  }));
  return {
    ...decorated,
    ACCOUNTS: accounts,
    CAMPAIGNS: campaigns,
    BRAND_CAMPAIGNS: brandCampaigns,
    accountById: (id) => accounts.find((account) => account.id === id),
    accountsOfOrgs: (orgIds, channel) => {
      const set = new Set(orgIds);
      return accounts.filter((account) => set.has(account.orgId) && (!channel || account.channel === channel));
    },
    campaignsOfAccounts: (accountIds, channel) => {
      const set = new Set(accountIds);
      return [...campaigns, ...brandCampaigns].filter(
        (campaign) => set.has(campaign.accountId) && (!channel || campaign.channel === channel),
      );
    },
  };
}

function stockDaysOf(mock, plan, t7) {
  const product = mock.PRODUCTS.find((item) => item.id === plan.productId);
  const dailyOrders = t7 && t7.orders > 0 ? t7.orders / 7 : 0;
  if (!product || dailyOrders <= 0) return null;
  return product.stock / dailyOrders;
}

function dataGapDetailsOf(account) {
  const details = [];
  const netAuthorized = account.dataSources.includes("商品交易");
  if (account.authorization !== "已授权") {
    if (!netAuthorized) {
      details.push({
        code: "net_unauthorized",
        label: "账户仅部分授权：商品交易未授权",
        detail: "无法计算净成交/退款，不能判断真实利润",
        severity: "blocking",
        blocksStart: true,
      });
    } else {
      details.push({
        code: "partial_auth",
        label: "账户仅部分授权",
        detail: "部分经营数据不可见，但当前所需数据可用",
        severity: "warning",
        blocksStart: false,
      });
    }
  } else if (!netAuthorized) {
    details.push({
      code: "net_unauthorized",
      label: "商品交易未授权",
      detail: "无法计算净成交/退款，不能判断真实利润",
      severity: "blocking",
      blocksStart: true,
    });
  }
  if (account.dataLagMinutes > 15) {
    details.push({
      code: "report_delay",
      label: `报表延迟 ${account.dataLagMinutes} 分钟`,
      detail: "实时判断需谨慎；7 天复盘影响相对较小",
      severity: "warning",
      blocksStart: false,
    });
  }
  return details;
}

function gapInfoOf(account) {
  const details = dataGapDetailsOf(account);
  return { details, labels: details.map((gap) => gap.label) };
}

function confidenceOf(gaps, sampleAdequate) {
  if (!sampleAdequate) return "low";
  if (gaps.length > 0) return "low";
  return "medium";
}

function impactLabel(score) {
  if (score >= 15000) return "高";
  if (score >= 5000) return "中";
  return "低";
}

function fmtMoney(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function fmtPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtStockDays(value) {
  if (value === null || value === undefined) return "未知";
  if (value >= 90) return "90+ 天";
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} 天`;
}

function scopeLine(account, plan) {
  return plan ? `${plan.name} · ${account.name}` : account.name;
}

function windowOf(series) {
  const points = series.slice(-7);
  if (!points.length) return null;
  return {
    start: points[0].date,
    end: points[points.length - 1].date,
    days: points.length,
    label: `${points[0].date} ~ ${points[points.length - 1].date} · 近 ${points.length} 天`,
  };
}

function baseRecommendation({ templateId, title, question, account, plan, metrics, situation = [], dataWindow = null, rationale, suggestion, criteria, guardrail, action, expected, riskLevel, riskText, costCap, costCapUnit, durationDays, score, sampleAdequate, sampleNote, dataGapDetails = [], goal, baseline }) {
  const required = new Set(
    templateId === "low_roi_high_spend" || templateId === "high_roi_low_spend"
      ? ["千川报表", "商品交易"]
      : ["千川报表"],
  );
  const blockingGaps = dataGapDetails.filter(
    (gap) => gap.blocksStart && (gap.code !== "net_unauthorized" || required.has("商品交易")),
  );
  const dataGaps = dataGapDetails.map((gap) => gap.label);
  const canStart = sampleAdequate && blockingGaps.length === 0;
  const startBlockReason = !sampleAdequate
    ? sampleNote
    : blockingGaps.length > 0
      ? `${blockingGaps[0].label}：${blockingGaps[0].detail}。当前只能「只观察」，或先补授权/等数据恢复。`
      : null;
  const confidence = confidenceOf(dataGaps, sampleAdequate);
  return {
    id: `rec_${templateId}_${plan?.id ?? account.id}`,
    templateId,
    templateLabel: TEMPLATE_LABEL[templateId] ?? templateId,
    category: "投放策略",
    title,
    question,
    scope: {
      accountId: account.id,
      accountName: account.name,
      planIds: plan ? [plan.id] : [],
      planName: plan?.name ?? null,
    },
    scopeLine: scopeLine(account, plan),
    dataWindow,
    situation,
    metrics,
    rationale,
    suggestion,
    criteria,
    guardrail,
    action,
    expected,
    riskLevel,
    riskText,
    costCap,
    costCapUnit,
    durationDays,
    score,
    impact: impactLabel(score),
    confidence,
    confidenceLabel: confidence === "high" ? "高" : confidence === "medium" ? "中" : "低",
    sampleAdequate,
    sampleNote,
    dataGaps,
    dataGapDetails,
    requiredData: [...required],
    canStart,
    startBlockReason,
    goal,
    baseline,
  };
}

function buildLearningRecommendation(mock, plan, account, t7, share, stockDays) {
  const goal = plan.roiGoal ?? 3.5;
  const conversions = t7.orders / 7;
  const sampleAdequate = conversions >= 20 && t7.cost >= 3000;
  const deltaPct = -10;
  const before = plan.budget;
  const after = round2(plan.budget * (1 + deltaPct / 100));
  const gapInfo = gapInfoOf(account);
  const score = Math.abs(goal - t7.roi) * t7.cost;
  return baseRecommendation({
    templateId: "learning_phase",
    title: "学习期计划：先降预算，还是直接停？",
    question: "学习期计划 ROI 低于目标时，暂停、降预算，还是继续观察？",
    account,
    plan,
    dataWindow: windowOf(plan.daily),
    situation: [
      `计划状态：${plan.status}；学习期第 ${plan.learningDays ?? "--"} 天`,
      `日预算 ${fmtMoney(plan.budget)}；占账户消耗 ${fmtPct(share)}`,
      `ROI ${t7.roi.toFixed(2)} / 目标 ${goal.toFixed(1)}；转化 ${Math.round(conversions)}/天`,
    ],
    metrics: [
      { label: "7 天 ROI", value: t7.roi.toFixed(2) },
      { label: "目标", value: goal.toFixed(1) },
      { label: "7 天消耗", value: fmtMoney(t7.cost) },
      { label: "转化/天", value: `${Math.round(conversions)}` },
    ],
    rationale: [
      `学习期第 ${plan.learningDays ?? "--"} 天，ROI ${t7.roi.toFixed(2)}，低于目标 ${goal.toFixed(1)}`,
      `近 7 天转化 ${Math.round(conversions)}/天，${sampleAdequate ? "样本够" : "样本偏小"}`,
      `计划占账户消耗 ${fmtPct(share)}，${stockDays !== null ? `库存可售 ${fmtStockDays(stockDays)}` : "库存未知"}`,
    ],
    suggestion: "预算 -10%，观察 3 天；不直接暂停",
    criteria: `3 天后 ROI ≥ ${(goal - 0.3).toFixed(1)} 且 GMV ≥ -5% → 继续；否则回滚`,
    guardrail: "单次预算 -10%；库存 ≥7 天；余额 ≥3 天；数据完整",
    action: {
      type: "budget",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "budget",
      before,
      after,
      unit: "元/日",
      deltaPct,
      tool: "adjust_plan_budget",
      actionLabel: "调整计划日预算",
    },
    expected: {
      label: "7 天支付ROI",
      value: round2(t7.roi + 0.27),
      unit: "",
      text: `计划日预算 ${fmtMoney(before)} → ${fmtMoney(after)} 元，观察 7 天 ROI 与 GMV`,
    },
    riskLevel: share > 0.5 || (stockDays !== null && stockDays < 7) ? "high" : "medium",
    riskText: stockDays !== null && stockDays < 7 ? "库存偏低，先确认补货再降预算" : "降预算会收缩消耗，但保留探索；3 天后可回滚",
    costCap: Math.round(Math.abs(plan.budget * deltaPct) / 100),
    costCapUnit: "元/天",
    durationDays: 7,
    score,
    sampleAdequate,
    sampleNote: sampleAdequate ? "转化 ≥20/天，够做 7 天小实验" : "转化 <20/天，建议只观察或扩大样本",
    dataGaps: gapInfo.labels,
    dataGapDetails: gapInfo.details,
    goal,
    baseline: {
      roi: t7.roi,
      cost7d: t7.cost,
      orders7d: t7.orders,
      conversions,
      planBudget: plan.budget,
      accountBudget: account.budget,
      capturedAt: Date.now(),
    },
  });
}

function buildBudgetCapRecommendation(mock, account, t7, plans, stockDays, { deltaPct = 10 } = {}) {
  const goal = 3.5;
  const today = lastPoint(account.daily);
  const todayCost = today?.cost ?? 0;
  const pacing = account.budget > 0 ? todayCost / account.budget : 0;
  const reducing = deltaPct < 0;
  const before = account.budget;
  const after = round2(account.budget * (1 + deltaPct / 100));
  const gapInfo = gapInfoOf(account);
  const conversions = t7.orders / 7;
  const sampleAdequate = conversions >= 20 && t7.cost >= 3000;
  const trend = trendOf(account.daily);
  const score = (account.budget * 0.1 * 7 * Math.max(1, t7.roi)) / 1;
  return baseRecommendation({
    templateId: "budget_cap",
    title: reducing ? "预算接近撞线：先降 10%，还是保持？" : "预算接近撞线：加预算 10%，还是保持？",
    question: reducing
      ? "账户预算快撞线，但 ROI 趋势不支持放量；先降 10% 保护 ROI，还是保持？"
      : "账户预算快撞线，ROI 达标，是否值得加 10% 预算换增量？",
    account,
    plan: null,
    dataWindow: windowOf(account.daily),
    situation: [
      `账户状态：${account.status}；今日预算使用率 ${fmtPct(pacing)}`,
      `日预算 ${fmtMoney(account.budget)}；7 天消耗 ${fmtMoney(t7.cost)}`,
      `ROI ${t7.roi.toFixed(2)} / 目标 ${goal.toFixed(1)}；库存 ${stockDays === null ? "未知" : fmtStockDays(stockDays)}`,
    ],
    metrics: [
      { label: "预算使用率", value: fmtPct(pacing) },
      { label: "7 天 ROI", value: t7.roi.toFixed(2) },
      { label: "目标", value: goal.toFixed(1) },
      { label: "库存", value: stockDays === null ? "--" : fmtStockDays(stockDays) },
    ],
    rationale: [
      `今日预算使用率 ${fmtPct(pacing)}（${fmtMoney(todayCost)} / ${fmtMoney(account.budget)}）`,
      `近 7 天 ROI ${t7.roi.toFixed(2)}，${t7.roi >= goal ? "高于" : "低于"}目标 ${goal.toFixed(1)}`,
      `近 3 天 ROI 趋势 ${trend.roi >= 0 ? "+" : ""}${trend.roi.toFixed(2)}，GMV 趋势 ${(trend.gmv * 100).toFixed(1)}%`,
      `库存可售 ${stockDays === null ? "未知" : fmtStockDays(stockDays)}，${stockDays !== null && stockDays >= 7 ? "可支撑加量" : "库存偏紧"}`,
    ],
    suggestion: reducing ? "预算 -10%，观察 3 天" : "预算 +10%，观察 7 天",
    criteria: reducing
      ? "3 天 ROI 回升 ≥0.2 且 GMV 不低于 -8% → 继续；否则回滚"
      : "7 天 GMV 提升 ≥5% 且 ROI 不低于 3.2 → 继续；否则回滚",
    guardrail: reducing
      ? "账户预算 -10%；库存 ≥7 天；余额 ≥3 天；不碰品牌预算"
      : "账户预算 +10%；库存 ≥7 天；余额 ≥3 天；不碰品牌预算",
    action: {
      type: "budget",
      targetType: "account",
      targetId: account.id,
      targetName: account.name,
      field: "budget",
      before,
      after,
      unit: "元/日",
      deltaPct,
      tool: "apply_budget_change",
      actionLabel: "调整账户日预算",
    },
    expected: {
      label: "7 天支付GMV",
      value: null,
      unit: "",
      text: reducing
        ? `账户日预算 ${fmtMoney(before)} → ${fmtMoney(after)} 元，先收缩低效消耗，ROI 可能回升，GMV 可能下降`
        : `账户日预算 ${fmtMoney(before)} → ${fmtMoney(after)} 元，预计带来增量 GMV，ROI 可能小幅回落`,
    },
    riskLevel: "medium",
    riskText: reducing ? "降预算可能损失 GMV；3 天内可回滚" : "加预算可能让 ROI 小幅回落；7 天内可回滚",
    costCap: Math.round(account.budget * Math.abs(deltaPct) / 100),
    costCapUnit: "元/天",
    durationDays: 7,
    score,
    sampleAdequate,
    sampleNote: sampleAdequate ? "账户转化量足够" : "账户转化量偏小，建议只观察",
    dataGaps: gapInfo.labels,
    dataGapDetails: gapInfo.details,
    goal,
    baseline: {
      roi: t7.roi,
      cost7d: t7.cost,
      orders7d: t7.orders,
      conversions,
      planBudget: null,
      accountBudget: account.budget,
      pacing,
      capturedAt: Date.now(),
    },
  });
}

function buildHighRoiRecommendation(mock, plan, account, t7, share, stockDays) {
  const goal = plan.roiGoal ?? 3.5;
  const conversions = t7.orders / 7;
  const sampleAdequate = conversions >= 20 && t7.cost >= 2000;
  const trend = trendOf(plan.daily);
  const deltaPct = 5;
  const before = plan.budget;
  const after = round2(plan.budget * (1 + deltaPct / 100));
  const gapInfo = gapInfoOf(account);
  const score = plan.budget * 0.05 * 7 * Math.max(1, t7.roi);
  return baseRecommendation({
    templateId: "high_roi_low_spend",
    title: "高 ROI 低消耗：加预算 5%，还是保持？",
    question: "这个计划 ROI 高但只占账户一小部分，是否值得加 5% 预算放量？",
    account,
    plan,
    dataWindow: windowOf(plan.daily),
    situation: [
      `计划状态：${plan.status}；ROI ${t7.roi.toFixed(2)} 高于目标 ${goal.toFixed(1)}`,
      `日预算 ${fmtMoney(plan.budget)}；占账户消耗 ${fmtPct(share)}`,
      `库存 ${stockDays === null ? "未知" : fmtStockDays(stockDays)}；转化 ${Math.round(conversions)}/天`,
    ],
    metrics: [
      { label: "7 天 ROI", value: t7.roi.toFixed(2) },
      { label: "目标", value: goal.toFixed(1) },
      { label: "消耗占比", value: fmtPct(share) },
      { label: "库存", value: stockDays === null ? "--" : fmtStockDays(stockDays) },
    ],
    rationale: [
      `ROI ${t7.roi.toFixed(2)}，高于目标 ${goal.toFixed(1)}`,
      `计划只占账户消耗 ${fmtPct(share)}，还有放量空间`,
      `近 3 天 ROI 趋势 ${trend.roi >= 0 ? "+" : ""}${trend.roi.toFixed(2)}，GMV 趋势 ${(trend.gmv * 100).toFixed(1)}%`,
      `库存可售 ${stockDays === null ? "未知" : fmtStockDays(stockDays)}，${stockDays !== null && stockDays >= 7 ? "可支撑" : "偏紧"}`,
    ],
    suggestion: "预算 +5%，观察 7 天；单次不超过 10%",
    criteria: "7 天 GMV 提升 ≥5% 且 ROI 不低于目标 -0.1 → 继续；否则回滚",
    guardrail: "单次预算 +5%；库存 ≥7 天；余额 ≥3 天",
    action: {
      type: "budget",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "budget",
      before,
      after,
      unit: "元/日",
      deltaPct,
      tool: "adjust_plan_budget",
      actionLabel: "调整计划日预算",
    },
    expected: {
      label: "7 天支付GMV",
      value: null,
      unit: "",
      text: `计划日预算 ${fmtMoney(before)} → ${fmtMoney(after)} 元，预计带来增量 GMV`,
    },
    riskLevel: "medium",
    riskText: "放量可能让 ROI 小幅回落；7 天内可回滚",
    costCap: Math.round(plan.budget * 0.05),
    costCapUnit: "元/天",
    durationDays: 7,
    score,
    sampleAdequate,
    sampleNote: sampleAdequate ? "转化量足够" : "转化量偏小，建议只观察",
    dataGaps: gapInfo.labels,
    dataGapDetails: gapInfo.details,
    goal,
    baseline: {
      roi: t7.roi,
      cost7d: t7.cost,
      orders7d: t7.orders,
      conversions,
      planBudget: plan.budget,
      accountBudget: account.budget,
      capturedAt: Date.now(),
    },
  });
}

function buildLowRoiRecommendation(mock, plan, account, t7, share, stockDays) {
  const goal = plan.roiGoal ?? 3.5;
  const conversions = t7.orders / 7;
  const sampleAdequate = conversions >= 20 && t7.cost >= 3000;
  const deltaPct = -10;
  const before = plan.budget;
  const after = round2(plan.budget * (1 + deltaPct / 100));
  const gapInfo = gapInfoOf(account);
  const score = Math.abs(goal - t7.roi) * t7.cost;
  return baseRecommendation({
    templateId: "low_roi_high_spend",
    title: "低 ROI 高消耗：降预算 10%，还是暂停？",
    question: "这个计划 ROI 低于目标、又占了账户大部分消耗，应该降预算还是直接暂停？",
    account,
    plan,
    dataWindow: windowOf(plan.daily),
    situation: [
      `计划状态：${plan.status}；ROI ${t7.roi.toFixed(2)} 低于目标 ${goal.toFixed(1)}`,
      `日预算 ${fmtMoney(plan.budget)}；占账户消耗 ${fmtPct(share)}`,
      `7 天消耗 ${fmtMoney(t7.cost)}；转化 ${Math.round(conversions)}/天`,
    ],
    metrics: [
      { label: "7 天 ROI", value: t7.roi.toFixed(2) },
      { label: "目标", value: goal.toFixed(1) },
      { label: "消耗占比", value: fmtPct(share) },
      { label: "转化/天", value: `${Math.round(conversions)}` },
    ],
    rationale: [
      `ROI ${t7.roi.toFixed(2)}，低于目标 ${goal.toFixed(1)}`,
      `计划占账户消耗 ${fmtPct(share)}，影响面大`,
      `近 7 天转化 ${Math.round(conversions)}/天，${sampleAdequate ? "样本够" : "样本偏小"}`,
    ],
    suggestion: "预算 -10%，观察 3 天；不直接暂停",
    criteria: `3 天后 ROI ≥ ${(goal - 0.2).toFixed(1)} 且 GMV ≥ -5% → 继续；否则回滚`,
    guardrail: "单次预算 -10%；库存 ≥7 天；余额 ≥3 天",
    action: {
      type: "budget",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "budget",
      before,
      after,
      unit: "元/日",
      deltaPct,
      tool: "adjust_plan_budget",
      actionLabel: "调整计划日预算",
    },
    expected: {
      label: "7 天支付ROI",
      value: round2(t7.roi + 0.2),
      unit: "",
      text: `计划日预算 ${fmtMoney(before)} → ${fmtMoney(after)} 元，先收缩低效消耗`,
    },
    riskLevel: share > 0.5 ? "high" : "medium",
    riskText: "计划占账户消耗较高，降预算会影响整体跑量；3 天后可回滚",
    costCap: Math.round(plan.budget * 0.1),
    costCapUnit: "元/天",
    durationDays: 7,
    score,
    sampleAdequate,
    sampleNote: sampleAdequate ? "转化量足够" : "转化量偏小，建议只观察",
    dataGaps: gapInfo.labels,
    dataGapDetails: gapInfo.details,
    goal,
    baseline: {
      roi: t7.roi,
      cost7d: t7.cost,
      orders7d: t7.orders,
      conversions,
      planBudget: plan.budget,
      accountBudget: account.budget,
      capturedAt: Date.now(),
    },
  });
}

function buildCandidates(mock, { allowIncrease = true, budgetCapDefensive = false } = {}) {
  const candidates = [];
  const seenPlans = new Set();
  const accounts = mock.ACCOUNTS.filter((account) => account.channel === "auction" && account.status === "投放中");

  for (const account of accounts) {
    const plans = mock.CAMPAIGNS.filter((plan) => plan.accountId === account.id && plan.status === "投放中");
    const account7 = totals(last7(account.daily));
    if (!account7) continue;

    for (const plan of plans) {
      if (seenPlans.has(plan.id)) continue;
      const t7 = totals(last7(plan.daily));
      if (!t7 || t7.cost < 1000) continue;
      const share = account7.cost > 0 ? t7.cost / account7.cost : 0;
      const stockDays = stockDaysOf(mock, plan, t7);
      const goal = plan.roiGoal ?? 3.5;
      const planTrend = trendOf(plan.daily);

      if (plan.learningPhase === "学习中" && t7.roi < goal - 0.2 && t7.cost >= 3000) {
        candidates.push(buildLearningRecommendation(mock, plan, account, t7, share, stockDays));
        seenPlans.add(plan.id);
        continue;
      }

      if (allowIncrease && t7.roi >= goal + 0.3 && share < 0.3 && t7.cost >= 2000 && (stockDays === null || stockDays >= 7) && planTrend.roi >= -0.05 && planTrend.gmv >= -0.05) {
        candidates.push(buildHighRoiRecommendation(mock, plan, account, t7, share, stockDays));
        seenPlans.add(plan.id);
        continue;
      }

      if (t7.roi < goal - 0.3 && share > 0.35 && t7.cost >= 5000) {
        candidates.push(buildLowRoiRecommendation(mock, plan, account, t7, share, stockDays));
        seenPlans.add(plan.id);
      }
    }

    const today = lastPoint(account.daily);
    const todayCost = today?.cost ?? 0;
    const pacing = account.budget > 0 ? todayCost / account.budget : 0;
    const accountTrend = trendOf(account.daily);
    const stockDays = plans.reduce((max, plan) => {
      const t7 = totals(last7(plan.daily));
      const days = t7 ? stockDaysOf(mock, plan, t7) : null;
      return days === null ? max : Math.max(max, days);
    }, 0);
    if ((allowIncrease || budgetCapDefensive) && pacing >= 0.75 && account7.roi >= 3.5 && stockDays >= 7 && account7.cost >= 5000 && accountTrend.roi >= -0.05 && accountTrend.gmv >= -0.05) {
      candidates.push(
        buildBudgetCapRecommendation(mock, account, account7, plans, stockDays, {
          deltaPct: budgetCapDefensive ? -10 : 10,
        }),
      );
    }
  }

  return candidates
    .filter((candidate) => candidate)
    .sort((a, b) => b.score - a.score);
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      experiments: Array.isArray(parsed.experiments) ? parsed.experiments : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return { experiments: [], dismissed: [] };
  }
}

function writeStore(store) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ experiments: store.experiments.slice(-100), dismissed: store.dismissed.slice(-200) }, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

function progressOf(experiment) {
  if (!experiment.startedAt) return { day: 0, total: experiment.proposal?.durationDays ?? 7, percent: 0 };
  const total = experiment.proposal?.durationDays ?? 7;
  const elapsed = Math.floor((Date.now() - experiment.startedAt) / 86400000) + 1;
  const day = Math.min(total, Math.max(1, elapsed));
  return { day, total, percent: Math.round((day / total) * 100) };
}

function syncExperiment(experiment) {
  let changed = false;
  if (experiment.status === "pending" && experiment.decisionId) {
    const decision = getDecision(experiment.decisionId);
    if (decision?.status === "approved") {
      experiment.status = "running";
      experiment.operationId = decision.operationId ?? null;
      experiment.startedAt = decision.decidedAt ?? Date.now();
      changed = true;
    } else if (decision?.status === "rejected" || decision?.status === "expired") {
      experiment.status = "cancelled";
      experiment.endedAt = decision.decidedAt ?? Date.now();
      changed = true;
    }
  }
  if (experiment.operationId) {
    const operation = getOperation(experiment.operationId);
    if (operation?.undone && experiment.status !== "reverted") {
      experiment.status = "reverted";
      experiment.endedAt = operation.undo_at ?? Date.now();
      changed = true;
    }
  }
  return changed;
}

function enrichExperiment(experiment) {
  const decision = experiment.decisionId ? getDecision(experiment.decisionId) : null;
  const operation = experiment.operationId ? getOperation(experiment.operationId) : null;
  return {
    ...experiment,
    decisionStatus: decision?.status ?? null,
    operationUndone: Boolean(operation?.undone),
    progress: progressOf(experiment),
    canReadout: experiment.status === "running" || experiment.status === "pending",
    canRollback: Boolean(experiment.operationId) && !operation?.undone,
  };
}

function summaryOf(experiments, recommendations) {
  return {
    suggested: recommendations.length,
    pending: experiments.filter((item) => item.status === "pending").length,
    running: experiments.filter((item) => item.status === "running").length,
    concluded: experiments.filter((item) => ["concluded", "reverted", "cancelled"].includes(item.status)).length,
    total: experiments.length,
  };
}

const DEFAULT_POLICY = "conservative";

export async function getRecommendations({ accountId = null, planId = null, limit = 3, asOf = null, policy = DEFAULT_POLICY, ignoreState = false } = {}) {
  const base = await loadMock();
  const mock = mockAsOf(base, asOf);
  const store = readStore();
  const activeRecommendations = new Set(
    store.experiments
      .filter((item) => ["pending", "running"].includes(item.status))
      .map((item) => item.recommendationId),
  );
  const conservative = policy === "conservative" || policy === "defensive";
  let recommendations = buildCandidates(mock, {
    allowIncrease: !conservative,
    budgetCapDefensive: policy === "defensive",
  }).filter(
    (item) => ignoreState || (!store.dismissed.includes(item.id) && !activeRecommendations.has(item.id)),
  );
  if (planId) {
    recommendations = recommendations.filter((item) => item.scope.planIds.includes(planId));
  } else if (accountId) {
    recommendations = recommendations.filter((item) => item.scope.accountId === accountId);
  }
  recommendations = recommendations.sort(
    (a, b) => Number(b.sampleAdequate) - Number(a.sampleAdequate) || b.score - a.score,
  );
  const total = recommendations.length;
  return {
    recommendations: recommendations.slice(0, Math.max(1, Math.min(10, limit))),
    total,
    generatedAt: Date.now(),
  };
}

export async function getExperimentLibrary({ accountId = null, planId = null } = {}) {
  const store = readStore();
  let changed = false;
  for (const experiment of store.experiments) {
    if (syncExperiment(experiment)) changed = true;
  }
  if (changed) writeStore(store);
  let experiments = store.experiments.slice().sort((a, b) => b.createdAt - a.createdAt);
  if (accountId) experiments = experiments.filter((item) => item.scope?.accountId === accountId);
  if (planId) experiments = experiments.filter((item) => item.scope?.planIds?.includes(planId));
  const recommendations = (await getRecommendations({ accountId, planId, limit: 3 })).recommendations;
  return {
    experiments: experiments.map(enrichExperiment),
    recommendations,
    summary: summaryOf(experiments, recommendations),
    generatedAt: Date.now(),
    note: "Phase 1 演示环境：实验复盘基于模拟数据；真实投放需接历史回放/实验平台。",
  };
}

export async function startExperiment({ recommendationId, mode = "start" }) {
  const normalizedMode = mode === "observe" ? "observe" : "start";
  const { recommendations } = await getRecommendations({ limit: 10 });
  const recommendation = recommendations.find((item) => item.id === recommendationId);
  if (!recommendation) return { ok: false, error: "推荐已失效，请刷新后重试" };
  if (normalizedMode === "start" && !recommendation.sampleAdequate) {
    return { ok: false, error: "样本不足，建议只观察或扩大范围" };
  }
  if (normalizedMode === "start" && recommendation.canStart === false) {
    return {
      ok: false,
      error: recommendation.startBlockReason ?? "数据缺口未满足，当前只能只观察或先补数据",
    };
  }

  const experimentId = uid("exp");
  let decision = null;
  if (normalizedMode === "start" && recommendation.action.type !== "observe") {
    const created = createDecision({
      runId: experimentId,
      experimentId,
      accountId: recommendation.scope.accountId,
      tool: recommendation.action.tool,
      action: recommendation.action.actionLabel,
      targetType: recommendation.action.targetType,
      targetId: recommendation.action.targetId,
      targetName: recommendation.action.targetName,
      field: recommendation.action.field,
      before: recommendation.action.before,
      after: recommendation.action.after,
      unit: recommendation.action.unit,
      reason: `${recommendation.title}：${recommendation.suggestion}`,
      evidence: recommendation.rationale,
      dataGaps: recommendation.dataGaps,
      expected: recommendation.expected,
      riskLevel: recommendation.riskLevel,
      riskText: recommendation.riskText,
    });
    if (!created.ok) return { ok: false, error: created.error };
    decision = created.decision;
  }

  const experiment = {
    id: experimentId,
    recommendationId: recommendation.id,
    templateId: recommendation.templateId,
    templateLabel: recommendation.templateLabel,
    category: recommendation.category,
    title: recommendation.title,
    question: recommendation.question,
    scope: recommendation.scope,
    scopeLine: recommendation.scopeLine,
    mode: normalizedMode,
    status: decision ? "pending" : "running",
    decisionId: decision?.id ?? null,
    operationId: null,
    baseline: recommendation.baseline,
    proposal: {
      ...recommendation.action,
      suggestion: recommendation.suggestion,
      expected: recommendation.expected,
      costCap: recommendation.costCap,
      costCapUnit: recommendation.costCapUnit,
      durationDays: recommendation.durationDays,
    },
    design: {
      primaryMetric: recommendation.templateId === "budget_cap" ? "7 天支付GMV" : "7 天支付ROI",
      guardrail: recommendation.guardrail,
      criteria: recommendation.criteria,
      checkpoints: [
        { day: 1, label: "确认动作已生效，数据正常" },
        { day: 3, label: "看 ROI 是否止跌/回升" },
        { day: 7, label: "看 GMV 与 ROI，决定继续或回滚" },
      ],
      sampleAdequate: recommendation.sampleAdequate,
      sampleNote: recommendation.sampleNote,
    },
    rationale: recommendation.rationale,
    guardrail: recommendation.guardrail,
    criteria: recommendation.criteria,
    riskLevel: recommendation.riskLevel,
    riskText: recommendation.riskText,
    confidence: recommendation.confidence,
    createdAt: Date.now(),
    startedAt: decision ? null : Date.now(),
    endedAt: null,
    readout: null,
  };

  const store = readStore();
  store.experiments.push(experiment);
  writeStore(store);
  return { ok: true, experiment: enrichExperiment(experiment) };
}

function buildReadout(experiment) {
  const progress = progressOf(experiment);
  const baselineRoi = experiment.baseline?.roi ?? 3.0;
  const noise = (rand(experiment.id, 1) - 0.5) * 0.02;

  if (experiment.mode === "observe") {
    return {
      simulated: true,
      ranAt: Date.now(),
      days: progress.day,
      verdict: "insufficient",
      verdictLabel: "仅观察",
      recommendation: "observe",
      confidence: "low",
      confidenceLabel: "低",
      plain: "只观察没有执行动作；这段时间的 ROI/GMV 变化不能归因于实验。建议先补数据，或开始一个带动作的小实验。",
      effect: { roi: noise, gmv: noise / 2 },
      stats: {
        baselineRoi,
        currentRoi: baselineRoi + noise,
        roiDelta: noise,
        gmvDelta: noise / 2,
        days: progress.day,
        sampleAdequate: false,
      },
      note: "演示环境：只观察实验不执行动作，复盘只展示基线波动。",
    };
  }

  const effect = EFFECTS[experiment.templateId] ?? EFFECTS.observe;
  const roiDelta = effect.roi + noise;
  const gmvDelta = effect.gmv + noise / 2;
  const currentRoi = baselineRoi + roiDelta;
  const sampleAdequate = experiment.design?.sampleAdequate ?? true;
  const verdict = !sampleAdequate ? "insufficient" : effect.verdict;
  const confidence = sampleAdequate && (experiment.confidence ?? "medium") !== "low" ? "medium" : "low";
  const recommendation = verdict === "insufficient" ? "observe" : effect.recommendation;

  const plainCore = (() => {
    if (verdict === "insufficient") {
      return "样本不足或数据不完整，暂时没有足够证据；建议只观察，先补数据或扩大样本。";
    }
    if (experiment.templateId === "learning_phase") {
      return `预算 -10% 后 ROI ${currentRoi.toFixed(2)}（实验前 ${baselineRoi.toFixed(2)}），GMV ${fmtPct(gmvDelta)}；建议继续用这个幅度，再观察一周确认。`;
    }
    if (experiment.templateId === "budget_cap") {
      return `加预算 10% 后 GMV ${fmtPct(gmvDelta)}，ROI ${currentRoi.toFixed(2)}；增量为正，建议继续保持，盯住 ROI 不破 3.2。`;
    }
    if (experiment.templateId === "high_roi_low_spend") {
      return `加预算 5% 后 GMV ${fmtPct(gmvDelta)}，ROI ${currentRoi.toFixed(2)}；增量为正，建议逐步扩到 10%。`;
    }
    return `降预算 10% 后 ROI ${currentRoi.toFixed(2)}，GMV ${fmtPct(gmvDelta)}；建议继续降本，但不要一刀切暂停。`;
  })();
  const plain = progress.day < 3 ? `D${progress.day} 提前复盘（样本偏小）：${plainCore}` : plainCore;

  return {
    simulated: true,
    ranAt: Date.now(),
    days: progress.day,
    verdict,
    verdictLabel:
      verdict === "positive" ? "建议继续" : verdict === "neutral" ? "效果不明显" : verdict === "negative" ? "建议回滚" : "样本不足",
    recommendation,
    confidence,
    confidenceLabel: confidence === "medium" ? "中" : "低",
    plain,
    effect: { roi: roiDelta, gmv: gmvDelta },
    stats: {
      baselineRoi,
      currentRoi,
      roiDelta,
      gmvDelta,
      days: progress.day,
      sampleAdequate,
    },
    note: "演示环境：复盘基于模拟实验数据，不是真实投放结果。",
  };
}

export async function readoutExperiment(id) {
  const store = readStore();
  const experiment = store.experiments.find((item) => item.id === id);
  if (!experiment) return { ok: false, error: "实验不存在" };
  syncExperiment(experiment);
  if (experiment.status === "pending") return { ok: false, error: "提案还未确认，先确认动作再复盘" };
  if (experiment.status === "concluded" && experiment.readout) {
    return { ok: true, experiment: enrichExperiment(experiment) };
  }
  if (!["running", "concluded"].includes(experiment.status)) {
    return { ok: false, error: "当前状态不能复盘" };
  }
  experiment.readout = buildReadout(experiment);
  experiment.status = "concluded";
  experiment.endedAt = Date.now();
  writeStore(store);
  return { ok: true, experiment: enrichExperiment(experiment) };
}

export async function stopExperiment(id, { rollback = false } = {}) {
  const store = readStore();
  const experiment = store.experiments.find((item) => item.id === id);
  if (!experiment) return { ok: false, error: "实验不存在" };
  syncExperiment(experiment);

  if (experiment.status === "pending") {
    if (experiment.decisionId) {
      rejectDecision(experiment.decisionId, { comment: "实验取消" });
    }
    experiment.status = "cancelled";
    experiment.endedAt = Date.now();
    writeStore(store);
    return { ok: true, experiment: enrichExperiment(experiment) };
  }

  if (experiment.status === "running") {
    experiment.readout = buildReadout(experiment);
    experiment.status = "concluded";
    experiment.endedAt = Date.now();
  }

  if (rollback && experiment.operationId) {
    const undone = undoOperation(experiment.operationId);
    if (!undone.ok) return { ok: false, error: undone.error };
    experiment.status = "reverted";
    experiment.endedAt = Date.now();
  }

  writeStore(store);
  return { ok: true, experiment: enrichExperiment(experiment) };
}

export async function rollbackExperiment(id) {
  const store = readStore();
  const experiment = store.experiments.find((item) => item.id === id);
  if (!experiment) return { ok: false, error: "实验不存在" };
  syncExperiment(experiment);
  if (experiment.status === "pending" && experiment.decisionId) {
    rejectDecision(experiment.decisionId, { comment: "实验取消" });
    experiment.status = "cancelled";
    experiment.endedAt = Date.now();
    writeStore(store);
    return { ok: true, experiment: enrichExperiment(experiment) };
  }
  if (!experiment.operationId) return { ok: false, error: "没有可回滚的动作" };
  const undone = undoOperation(experiment.operationId);
  if (!undone.ok) return { ok: false, error: undone.error };
  experiment.status = "reverted";
  experiment.endedAt = Date.now();
  writeStore(store);
  return { ok: true, experiment: enrichExperiment(experiment) };
}

export async function dismissRecommendation(recommendationId) {
  if (!recommendationId) return { ok: false, error: "缺少推荐 id" };
  const store = readStore();
  if (!store.dismissed.includes(recommendationId)) {
    store.dismissed.push(recommendationId);
    writeStore(store);
  }
  return { ok: true, dismissed: store.dismissed.length };
}


