import {
  accountTrend,
  audienceSegments,
  budgetPacing,
  categoryTrends,
  comparePeriods,
  findAccount,
  findCampaign,
  opportunityScan,
  orgSummary,
  queryAccounts,
  queryPlans,
  simulateBudgetChange,
} from "./data-service.mjs";
import { decorateMock, EXECUTION_GUARDRAILS } from "./operations.mjs";
import { createDecision } from "./decisions.mjs";
import { skillCatalogForExpert, loadSkillDetail } from "./skills.mjs";
import { listExpertConfigs } from "./experts.mjs";
import { accountGaps, writeGate } from "./guardrails.mjs";

const rangeSchema = {
  type: "object",
  properties: {
    start: { type: "string", description: "YYYY-MM-DD，可选；默认使用当前看板周期" },
    end: { type: "string", description: "YYYY-MM-DD，可选" },
  },
};

const money = (value) => (value === null || value === undefined ? "--" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 }));
const round2 = (value) => Math.round(value * 100) / 100;

function scopeError(ctx, targetType, targetId) {
  const scope = ctx.requestedTargets;
  if (!scope || (!scope.accountIds.length && !scope.planIds.length)) return null;
  if (scope.invalid) return "用户指定的账户/计划不存在，不能对其它目标提交动作";
  const allowed = targetType === "account" ? scope.accountIds : scope.planIds;
  if (!allowed.includes(targetId)) {
    if (allowed.length === 0) {
      return targetType === "account"
        ? "用户只指定了计划级目标，不能改账户日预算（会影响账户内其它计划），请改用计划级动作"
        : "本次没有指定可写的计划";
    }
    return `动作目标 ${targetId} 不在本次任务指定范围（${allowed.join(", ")}）`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 机会洞察                                                            */
/* ------------------------------------------------------------------ */

const OPPORTUNITY_TOOLS = [
  {
    name: "get_market_trends",
    description: "查询某个类目的搜索热度、增长趋势、竞品动作与竞价区间。用于判断是否值得加码。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "类目名称，如 女装/美妆个护/食品饮料/数码潮玩/户外运动/家居家纺" },
        days: { type: "integer", minimum: 7, maximum: 30, description: "观察窗口，默认 14 天" },
      },
      required: ["category"],
    },
    handler: ({ args }) => categoryTrends(args.category ?? "服饰生活", args.days ?? 14),
  },
  {
    name: "get_audience_segments",
    description: "查询该类目的高潜人群画像（规模、TGI 指数、增量评分、活跃时段）。",
    parameters: {
      type: "object",
      properties: { category: { type: "string" } },
      required: ["category"],
    },
    handler: ({ args }) => audienceSegments(args.category ?? "服饰生活"),
  },
  {
    name: "find_opportunities",
    description: "扫描当前账户组合，找出高 ROI 未打满、消耗低效、余额风险等可执行机会，并按机会分排序。",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["auction", "brand"] },
        scope: { type: "string", description: "可选：组织名称或 all" },
      },
    },
    handler: ({ args, ctx }) =>
      opportunityScan(ctx.mock, { channel: args.channel ?? ctx.channel, range: ctx.range }),
  },
];

/* ------------------------------------------------------------------ */
/* 数据分析                                                            */
/* ------------------------------------------------------------------ */

const ANALYTICS_TOOLS = [
  {
    name: "query_accounts",
    description: "按消耗/ROI/订单成本等维度查询账户列表，可筛选渠道、组织、关键词与阈值。返回聚合指标。",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", enum: ["auction", "brand"] },
        org: { type: "string", description: "组织名称或 ID，可选" },
        search: { type: "string", description: "账户名称/ID/备注关键词" },
        sort_by: { type: "string", enum: ["cost", "roi", "cpa", "orders", "balance", "ctr"] },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
        min_cost: { type: "number" },
        min_roi: { type: "number" },
        max_roi: { type: "number" },
        range: rangeSchema,
      },
    },
    handler: ({ args, ctx }) => queryAccounts(ctx.mock, args, ctx.range),
  },
  {
    name: "query_plans",
    description: "查询推广计划维度数据：消耗、ROI、订单成本、状态、预算、出价、商品库存/可售天数、退款/净成交、素材拒审。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "可选，限定某个账户" },
        status: { type: "string", enum: ["投放中", "已暂停", "审核中", "已结束"] },
        mode: { type: "string", enum: ["全域推广", "标准推广", "品牌预定单"] },
        sort_by: { type: "string", enum: ["cost", "roi", "cpa", "orders"] },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", minimum: 1, maximum: 30 },
        range: rangeSchema,
      },
    },
    handler: ({ args, ctx }) => queryPlans(ctx.mock, args, ctx.range),
  },
  {
    name: "get_account_trend",
    description: "查询单个账户最近 N 天的消耗、支付金额、订单与 ROI 日序列，用于定位拐点。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        days: { type: "integer", minimum: 3, maximum: 30 },
      },
      required: ["account_id"],
    },
    handler: ({ args, ctx }) => accountTrend(ctx.mock, args.account_id, args.days ?? 14),
  },
  {
    name: "compare_periods",
    description: "对比当前周期与上一周期的消耗、支付金额、订单、ROI、订单成本变化。可指定账户。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "可选；不传则对比全部竞价账户" },
        range: rangeSchema,
      },
    },
    handler: ({ args, ctx }) => comparePeriods(ctx.mock, args, ctx.range),
  },
  {
    name: "get_org_summary",
    description: "查询组织维度汇总：子组织的账户数、消耗、支付金额、订单、ROI、订单成本、余额。",
    parameters: {
      type: "object",
      properties: { org_id: { type: "string", description: "可选，默认集团根节点" } },
    },
    handler: ({ args, ctx }) => orgSummary(ctx.mock, args.org_id),
  },
];

/* ------------------------------------------------------------------ */
/* 广告投放（只提交审批，不直接写）                                      */
/* ------------------------------------------------------------------ */

const ADS_TOOLS = [
  {
    name: "get_budget_pacing",
    description: "查询账户今日预算消耗进度、近 7 天日均消耗、余额与可支撑天数。",
    parameters: {
      type: "object",
      properties: { account_id: { type: "string" } },
      required: ["account_id"],
    },
    handler: ({ args, ctx }) => budgetPacing(ctx.mock, args.account_id),
  },
  {
    name: "get_account_plans",
    description: "查询指定账户的计划清单（消耗、ROI、预算、出价、状态），用于定位要调整的计划。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        status: { type: "string", enum: ["投放中", "已暂停", "审核中", "已结束"] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["account_id"],
    },
    handler: ({ args, ctx }) => queryPlans(ctx.mock, { ...args, limit: args.limit ?? 8 }, ctx.range),
  },
  {
    name: "forecast_plan",
    description:
      "【只读预测】预测一个计划未来 3-7 天的消耗、成交、ROI 区间，并给出建议动作、置信度、验证点与回滚条件。用于回答“接下来怎么走”。",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string", description: "计划 ID；先用 query_plans / get_account_plans 获取" },
        horizon_days: { type: "integer", minimum: 3, maximum: 7, description: "预测天数，默认 7" },
      },
      required: ["plan_id"],
    },
    handler: ({ args, ctx }) => {
      const plan = findCampaign(ctx.mock, args.plan_id);
      if (!plan) return { error: `计划不存在：${args.plan_id}` };
      return ctx.mock.forecastPlan(plan, ctx.range, { horizonDays: args.horizon_days ?? 7 });
    },
  },
  {
    name: "simulate_budget_change",
    description: "在不改动账户的情况下，模拟预算 ±% 调整后的预期消耗、支付金额、ROI 与可行性。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        delta_pct: { type: "number", minimum: -30, maximum: 30 },
      },
      required: ["account_id", "delta_pct"],
    },
    handler: ({ args, ctx }) => simulateBudgetChange(ctx.mock, args, ctx.range),
  },
  {
    name: "apply_budget_change",
    description:
      "【提交审批】调整账户日预算。只生成待优化师确认的动作，不直接生效；确认后才写入审计，可在页面撤销。单次幅度不超过 ±20%。",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string" },
        delta_pct: { type: "number", minimum: -20, maximum: 20 },
        reason: { type: "string", description: "基于数据的调整理由，引用具体指标" },
      },
      required: ["account_id", "delta_pct", "reason"],
    },
    handler: ({ args, ctx }) => {
      const account = findAccount(ctx.mock, args.account_id);
      if (!account) return { ok: false, error: `账户不存在：${args.account_id}` };
      const delta = Number(args.delta_pct);
      const violations = [];
      if (!Number.isFinite(delta) || delta === 0) violations.push("预算调整幅度必须为非零数值");
      if (Math.abs(delta) > EXECUTION_GUARDRAILS.maxBudgetDeltaPct) {
        violations.push(`单次预算调整不得超过 ±${EXECUTION_GUARDRAILS.maxBudgetDeltaPct}%`);
      }
      if (account.channel === "brand" && EXECUTION_GUARDRAILS.brandBudgetBlocked) {
        violations.push("品牌投放预算需品牌团队复核，当前只允许竞价账户直接修改");
      }
      const scope = scopeError(ctx, "account", account.id);
      if (scope) return { ok: false, error: scope };
      const gate = writeGate(ctx.mock, "account", account.id);
      if (gate) return { ok: false, error: gate.message, violations: gate.gaps, dataGaps: gate.gaps };
      const simulation = simulateBudgetChange(ctx.mock, { account_id: account.id, delta_pct: delta }, ctx.range);
      if (simulation?.feasibility?.meets_roi_floor === false) {
        violations.push(`调整后预测 ROI 低于底线 ${EXECUTION_GUARDRAILS.minProjectedRoi}`);
      }
      if (account.balance < EXECUTION_GUARDRAILS.minBalance) {
        violations.push(`账户余额低于 ${EXECUTION_GUARDRAILS.minBalance} 元，请先充值`);
      }
      if (violations.length) {
        return { ok: false, violations, message: "动作未提交：未通过护栏校验" };
      }

      const before = round2(account.budget);
      const after = round2(account.budget * (1 + delta / 100));
      const accountTotals = ctx.mock.sumSeries(account.daily, ctx.range);
      const dailyCost = accountTotals.cost / 7;
      const balanceDays = dailyCost > 0 ? round2(account.balance / dailyCost) : null;
      const riskLevel = delta > 10 || Math.abs(delta) >= EXECUTION_GUARDRAILS.maxBudgetDeltaPct
        ? "high"
        : delta > 0
          ? "medium"
          : "low";
      const decision = createDecision({
        runId: ctx.runId,
        workspaceId: ctx.workspaceId ?? null,
        tool: "apply_budget_change",
        action: "调整日预算",
        targetType: "account",
        targetId: account.id,
        targetName: account.name,
        field: "budget",
        before,
        after,
        unit: "元/日",
        reason: args.reason,
        evidence: [
          `近 7 天 ROI ${round2(ctx.mock.roiOf(accountTotals))}，订单成本 ${round2(ctx.mock.cpaOf(accountTotals))} 元`,
          `账户余额 ${money(account.balance)} 元，按近 7 天日均消耗可支撑 ${balanceDays ?? "--"} 天`,
          `调整幅度 ${delta > 0 ? "+" : ""}${delta}%，近 7 天消耗 ${money(accountTotals.cost)} 元`,
        ],
        dataGaps: accountGaps(account).gaps,
        expected: {
          label: "整体支付ROI",
          value: simulation?.projected?.roi ?? null,
          unit: "",
          text: `日预算 ${money(before)} → ${money(after)} 元，预计支付金额变化 ${money(simulation?.projected?.incremental_revenue)} 元`,
        },
        riskLevel,
        riskText: riskLevel === "high" ? "预算幅度较大，请确认库存、活动与余额" : "请在确认前复核近期 ROI 与库存",
      });
      if (!decision.ok) return { ok: false, error: decision.error };
      ctx.emit?.({ type: "decision_created", decision: decision.decision });
      return {
        ok: true,
        pending: true,
        decision: decision.decision,
        message: `已提交审批：${account.name} 日预算 ${money(before)} → ${money(after)} 元，等待优化师确认`,
        projected: simulation?.projected,
        violations: [],
      };
    },
  },
  {
    name: "pause_plan",
    description:
      "【提交审批】暂停一个正在投放的计划。只生成待优化师确认的动作，不直接生效；确认后写入审计并可在页面撤销。",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["plan_id", "reason"],
    },
    handler: ({ args, ctx }) => {
      const plan = findCampaign(ctx.mock, args.plan_id);
      if (!plan) return { ok: false, error: `计划不存在：${args.plan_id}` };
      if (plan.status !== "投放中") return { ok: false, error: `计划当前状态为「${plan.status}」，无法暂停` };
      const account = ctx.mock.accountById(plan.accountId);
      if (!account) return { ok: false, error: "计划归属账户不存在" };
      const scope = scopeError(ctx, "plan", plan.id);
      if (scope) return { ok: false, error: scope };
      const gate = writeGate(ctx.mock, "plan", plan.id);
      if (gate) return { ok: false, error: gate.message, violations: gate.gaps, dataGaps: gate.gaps };
      const accountTotals = ctx.mock.sumSeries(account.daily, ctx.range);
      const planTotals = ctx.mock.sumSeries(plan.daily, ctx.range);
      const share = accountTotals.cost > 0 ? planTotals.cost / accountTotals.cost : 0;
      const riskLevel = share > 0.5 ? "high" : "medium";
      const decision = createDecision({
        runId: ctx.runId,
        workspaceId: ctx.workspaceId ?? null,
        tool: "pause_plan",
        action: "暂停计划",
        targetType: "plan",
        targetId: plan.id,
        targetName: plan.name,
        field: "status",
        before: plan.status,
        after: "已暂停",
        unit: "",
        reason: args.reason,
        evidence: [
          `计划占账户消耗 ${(share * 100).toFixed(1)}%`,
          `计划 ROI ${round2(ctx.mock.roiOf(planTotals))}，订单成本 ${round2(ctx.mock.cpaOf(planTotals))} 元`,
        ],
        dataGaps: accountGaps(account).gaps,
        expected: {
          label: "账户整体支付ROI",
          value: ctx.mock.roiOf(accountTotals),
          unit: "",
          text: `暂停后低效消耗收缩，预计账户 ROI 回升（该计划占账户消耗 ${(share * 100).toFixed(1)}%）`,
        },
        riskLevel,
        riskText: share > 0.5 ? "该计划占账户消耗超过 50%，暂停影响较大" : "暂停后可在操作审计中撤销",
      });
      if (!decision.ok) return { ok: false, error: decision.error };
      ctx.emit?.({ type: "decision_created", decision: decision.decision });
      return {
        ok: true,
        pending: true,
        decision: decision.decision,
        message: `已提交审批：暂停计划「${plan.name}」，等待优化师确认`,
      };
    },
  },
  {
    name: "resume_plan",
    description: "【提交审批】恢复一个已暂停的计划。只生成待优化师确认的动作，不直接生效。",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        reason: { type: "string" },
      },
      required: ["plan_id", "reason"],
    },
    handler: ({ args, ctx }) => {
      const plan = findCampaign(ctx.mock, args.plan_id);
      if (!plan) return { ok: false, error: `计划不存在：${args.plan_id}` };
      if (plan.status !== "已暂停") return { ok: false, error: `计划当前状态为「${plan.status}」，无需恢复` };
      const account = ctx.mock.accountById(plan.accountId);
      if (!account) return { ok: false, error: "计划归属账户不存在" };
      const scope = scopeError(ctx, "plan", plan.id);
      if (scope) return { ok: false, error: scope };
      const gate = writeGate(ctx.mock, "plan", plan.id);
      if (gate) return { ok: false, error: gate.message, violations: gate.gaps, dataGaps: gate.gaps };
      const decision = createDecision({
        runId: ctx.runId,
        workspaceId: ctx.workspaceId ?? null,
        tool: "resume_plan",
        action: "恢复计划",
        targetType: "plan",
        targetId: plan.id,
        targetName: plan.name,
        field: "status",
        before: plan.status,
        after: "投放中",
        unit: "",
        reason: args.reason,
        evidence: ["计划当前处于暂停状态", `出价 ${money(plan.bid)} 元，日预算 ${money(plan.budget)} 元`],
        dataGaps: accountGaps(account).gaps,
        expected: { label: "账户整体支付ROI", value: null, unit: "", text: "恢复投放后观察 3 天消耗与 ROI" },
        riskLevel: "low",
        riskText: "恢复后可在操作审计中撤销",
      });
      if (!decision.ok) return { ok: false, error: decision.error };
      ctx.emit?.({ type: "decision_created", decision: decision.decision });
      return {
        ok: true,
        pending: true,
        decision: decision.decision,
        message: `已提交审批：恢复计划「${plan.name}」，等待优化师确认`,
      };
    },
  },
  {
    name: "adjust_bid",
    description:
      "【提交审批】调整计划出价，幅度不超过 ±15%。只生成待优化师确认的动作，不直接生效；确认后写入审计并可在页面撤销。",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        delta_pct: { type: "number", minimum: -15, maximum: 15 },
        reason: { type: "string" },
      },
      required: ["plan_id", "delta_pct", "reason"],
    },
    handler: ({ args, ctx }) => {
      const plan = findCampaign(ctx.mock, args.plan_id);
      if (!plan) return { ok: false, error: `计划不存在：${args.plan_id}` };
      const delta = Number(args.delta_pct);
      if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "出价调整幅度必须为非零数值" };
      if (Math.abs(delta) > EXECUTION_GUARDRAILS.maxBidDeltaPct) {
        return { ok: false, error: `单次出价调整不得超过 ±${EXECUTION_GUARDRAILS.maxBidDeltaPct}%` };
      }
      const scope = scopeError(ctx, "plan", plan.id);
      if (scope) return { ok: false, error: scope };
      const gate = writeGate(ctx.mock, "plan", plan.id);
      if (gate) return { ok: false, error: gate.message, violations: gate.gaps, dataGaps: gate.gaps };
      const account = ctx.mock.accountById(plan.accountId);
      const before = round2(plan.bid);
      const after = round2(plan.bid * (1 + delta / 100));
      const riskLevel = Math.abs(delta) >= EXECUTION_GUARDRAILS.maxBidDeltaPct ? "high" : "medium";
      const decision = createDecision({
        runId: ctx.runId,
        workspaceId: ctx.workspaceId ?? null,
        tool: "adjust_bid",
        action: "调整出价",
        targetType: "plan",
        targetId: plan.id,
        targetName: plan.name,
        field: "bid",
        before,
        after,
        unit: "元",
        reason: args.reason,
        evidence: [
          `当前出价 ${money(before)} 元，调整 ${delta > 0 ? "+" : ""}${delta}%`,
          `计划 ROI ${round2(ctx.mock.roiOf(ctx.mock.sumSeries(plan.daily, ctx.range)))}`,
        ],
        dataGaps: accountGaps(account).gaps,
        expected: { label: "整体支付ROI", value: null, unit: "", text: `出价 ${money(before)} → ${money(after)} 元，观察 3 天 ROI` },
        riskLevel,
        riskText: riskLevel === "high" ? "接近单次出价调整上限" : "观察 3 天后可再评估",
      });
      if (!decision.ok) return { ok: false, error: decision.error };
      ctx.emit?.({ type: "decision_created", decision: decision.decision });
      return {
        ok: true,
        pending: true,
        decision: decision.decision,
        message: `已提交审批：调整计划「${plan.name}」出价 ${money(before)} → ${money(after)} 元，等待优化师确认`,
      };
    },
  },
];

/* ------------------------------------------------------------------ */
/* Expert catalog                                                      */
/* ------------------------------------------------------------------ */

const TOOL_GROUPS = {
  opportunity: OPPORTUNITY_TOOLS,
  analytics: ANALYTICS_TOOLS,
  ads: ADS_TOOLS,
};

export const EXPERTS = listExpertConfigs().map((config) => {
  const group = TOOL_GROUPS[config.id] ?? [];
  const tools = config.connectorIds.length
    ? config.connectorIds
        .map((id) => group.find((tool) => tool.name === id))
        .filter((tool) => Boolean(tool))
    : group;
  return {
    ...config,
    toolNames: tools.map((tool) => tool.name),
    tools,
  };
});

export function expertById(id) {
  return EXPERTS.find((expert) => expert.id === id) ?? null;
}

export function toolSchemas(expertId) {
  const expert = expertById(expertId);
  if (!expert) return [];
  return [
    {
      type: "function",
      function: {
        name: "load_skill",
        description:
          "读取技能完整步骤、阈值、输出格式与失败处理。技能摘要里只给名称/描述；需要按某套方法执行时再调用它。",
        parameters: {
          type: "object",
          properties: {
            skill_id: { type: "string", description: "技能 ID，来自技能摘要" },
          },
          required: ["skill_id"],
        },
      },
    },
    ...expert.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  ];
}

export async function executeTool(expertId, name, args, ctx) {
  if (name === "load_skill") {
    const detail = loadSkillDetail(String(args?.skill_id ?? ""), expertId);
    if (!detail) {
      return { ok: false, error: `专家 ${expertId} 无权加载技能 ${args?.skill_id ?? ""}` };
    }
    return { ok: true, result: detail, meta: { skill: true } };
  }
  const expert = expertById(expertId);
  const tool = expert?.tools.find((item) => item.name === name);
  if (!tool) {
    return { ok: false, error: `专家 ${expertId} 无权调用工具 ${name}` };
  }
  try {
    // 每次工具调用前刷新"当前账户状态"，让同一轮里刚执行的动作立刻可被查询到。
    if (ctx.baseMock) ctx.mock = decorateMock(ctx.baseMock);
    const result = await tool.handler({ args: args ?? {}, ctx });
    if (result === null || result === undefined) {
      return { ok: false, error: "未查询到数据，请检查参数" };
    }
    if (typeof result === "object" && !Array.isArray(result) && result.error && !result.ok) {
      return { ok: false, error: String(result.error) };
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "工具执行失败" };
  }
}

export function toolCatalog() {
  return EXPERTS.map((expert) => ({
    id: expert.id,
    name: expert.name,
    role: expert.role,
    success: expert.success,
    canWrite: expert.canWrite,
    skills: skillCatalogForExpert(expert.id),
    tools: expert.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  }));
}
