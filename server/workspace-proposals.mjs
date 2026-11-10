import { chat } from "./llm.mjs";
import { budgetPacing, normalizeRange, simulateBudgetChange } from "./data-service.mjs";
import { loadMock } from "./mock.mjs";
import { decorateMock, EXECUTION_GUARDRAILS } from "./operations.mjs";
import { createDecision } from "./decisions.mjs";

const MAX_ACTIONS = 2;

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function money(value) {
  return Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function parseJson(text) {
  const cleaned = String(text ?? "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function buildScope(productId) {
  const base = await loadMock();
  const mock = decorateMock(base);
  const product = mock.PRODUCTS.find((item) => item.id === productId);
  if (!product) return null;
  const account = mock.accountById(product.accountId);
  if (!account) return null;
  const plans = [...mock.CAMPAIGNS, ...mock.BRAND_CAMPAIGNS].filter((plan) => plan.productId === product.id);
  const range = normalizeRange(mock, {});
  const planRows = plans.map((plan) => {
    const totals = mock.sumSeries(plan.daily, range);
    return {
      plan,
      totals,
      share: 0,
    };
  });
  const accountTotals = mock.sumSeries(account.daily, range);
  for (const row of planRows) {
    row.share = accountTotals.cost > 0 ? row.totals.cost / accountTotals.cost : 0;
  }
  const totalOrders = planRows.reduce((sum, row) => sum + row.totals.orders, 0);
  const dailyOrders = totalOrders / 7;
  const stockDays = dailyOrders > 0 ? product.stock / dailyOrders : null;
  return { mock, product, account, plans, planRows, accountTotals, range, stockDays, pacing: budgetPacing(mock, account.id) };
}

function buildPrompt(scope, input) {
  const { product, account, planRows, accountTotals, stockDays, pacing, range } = scope;
  const planLines = planRows
    .map(
      (row) =>
        `- ${row.plan.name}（plan_id: ${row.plan.id}）：状态 ${row.plan.status}；日预算 ${money(row.plan.budget)}；出价 ${money(row.plan.bid)}；近7天消耗 ${money(row.totals.cost)}、支付 ${money(row.totals.revenue)}、订单 ${row.totals.orders}、ROI ${round2(scope.mock.roiOf(row.totals))}、订单成本 ${round2(scope.mock.cpaOf(row.totals))}；占账户消耗 ${(row.share * 100).toFixed(1)}%`,
    )
    .join("\n");
  return `【商品工作区执行提案】
用户请求：${input.message}
上一轮助手方案：${String(input.assistantText ?? "").slice(0, 1800) || "（无）"}

范围（只能在这个范围内提案，不能越界）：
- 商品：${product.name}（product_id: ${product.id}），价格 ${money(product.price)}，库存 ${product.stock}，状态 ${product.status}
- 账户：${account.name}（account_id: ${account.id}），状态 ${account.status}，日预算 ${money(account.budget)}，余额 ${money(account.balance)}
- 计划：
${planLines || "（无计划）"}

近 7 天汇总：消耗 ${money(accountTotals.cost)}、支付 ${money(accountTotals.revenue)}、订单 ${accountTotals.orders}、ROI ${round2(scope.mock.roiOf(accountTotals))}、订单成本 ${round2(scope.mock.cpaOf(accountTotals))}
库存可售天数：${stockDays === null ? "未知" : `${stockDays.toFixed(1)} 天`}
预算进度：日预算 ${money(pacing.daily_budget)}，今日消耗 ${money(pacing.today_cost)}，余额可支撑 ${pacing.runway_days ?? "--"} 天

护栏：预算单次 ≤ ±${EXECUTION_GUARDRAILS.maxBudgetDeltaPct}%；出价单次 ≤ ±${EXECUTION_GUARDRAILS.maxBidDeltaPct}%；竞价账户预测 ROI ≥ ${EXECUTION_GUARDRAILS.minProjectedRoi}；余额 < ${EXECUTION_GUARDRAILS.minBalance} 不提案；账户级品牌预算拦截；最多 ${MAX_ACTIONS} 个动作。

只输出 JSON，不要 markdown：
{
  "actions": [
    {
      "type": "budget | plan_budget | bid | pause | resume",
      "targetId": "account_id 或 plan_id，必须来自上面列表",
      "deltaPct": 5,
      "reason": "必须引用具体数字",
      "evidence": ["1-3 条数据依据"],
      "riskLevel": "low | medium | high",
      "riskText": "一句话风险提示",
      "dataGaps": ["可选"]
    }
  ],
  "ask": "如果无法提案或需要用户补充信息，写一句；否则空字符串"
}

规则：
1. 只有用户明确要求执行（执行 / 按规划 / 加预算 / 降预算 / 提高日投放 / 调出价 / 暂停 / 恢复）且方案有具体动作时才输出 actions；否则 actions 为空，ask 说明需要什么。
2. 不要编造 account_id / plan_id；不支持新建计划、复制计划、改素材、改库存；这类请求放 ask。
3. 账户预算用 budget，targetId 用 account_id；计划预算用 plan_budget，targetId 用 plan_id。“计划日预算 / 这条计划日投放”一律用 plan_budget；出价/暂停/恢复用 plan_id。
4. 如果库存可售天数 < 7 且要加预算，riskLevel 至少 medium，dataGaps 写“静态库存/补货时间需人工确认”；品牌计划预算 riskLevel 至少 high。
5. 品牌计划（无支付归因、ROI 为 0）可以提交 plan_budget，不要用“预测 ROI < 2.5”拒绝；按消耗、展示、CPM、CTR、预算使用率和余额评估，riskLevel 至少 high，并提示品牌排期/承接需确认。
6. 用户说“已补货”只能作为用户补充，不得改写库存数字。
7. reason ≤ 100 字，每条 evidence ≤ 60 字，ask ≤ 120 字；输出必须是完整 JSON，不要省略引号或括号。`;
}

function riskForBudget(delta, stockDays) {
  if (stockDays !== null && stockDays < 7) return "high";
  if (Math.abs(delta) > 10 || Math.abs(delta) >= EXECUTION_GUARDRAILS.maxBudgetDeltaPct) return "high";
  return delta > 0 ? "medium" : "low";
}

function decisionFromAction(scope, input, action, state) {
  const { mock, product, account, plans } = scope;
  const type = String(action.type ?? "");
  const reason = String(action.reason ?? "").slice(0, 400);
  if (!reason) return { error: "动作缺少理由" };
  const evidence = Array.isArray(action.evidence) ? action.evidence.map(String).slice(0, 4) : [];
  const dataGaps = Array.isArray(action.dataGaps) ? action.dataGaps.map(String).slice(0, 4) : [];
  const base = {
    runId: input.runId,
    workspaceId: input.workspaceId,
    productId: product.id,
    accountId: account.id,
    allowedPlanIds: plans.map((plan) => plan.id),
    evidence,
    dataGaps,
    requestedBy: "agent",
  };
  if (type === "budget") {
    const delta = Number(action.deltaPct);
    if (!Number.isFinite(delta) || delta === 0) return { error: "预算幅度无效" };
    if (Math.abs(delta) > EXECUTION_GUARDRAILS.maxBudgetDeltaPct) return { error: "预算幅度超过护栏" };
    if (account.channel === "brand" && EXECUTION_GUARDRAILS.brandBudgetBlocked) return { error: "品牌预算需品牌团队复核" };
    if (account.balance < EXECUTION_GUARDRAILS.minBalance) return { error: "余额不足，先充值" };
    const simulation = simulateBudgetChange(mock, { account_id: account.id, delta_pct: delta }, scope.range);
    if (simulation?.feasibility?.meets_roi_floor === false) return { error: "预测 ROI 低于底线" };
    return createDecision({
      ...base,
      tool: "apply_budget_change",
      action: "调整日预算",
      targetType: "account",
      targetId: account.id,
      targetName: account.name,
      field: "budget",
      before: round2(account.budget),
      after: round2(account.budget * (1 + delta / 100)),
      unit: "元/日",
      reason,
      expected: {
        label: "整体支付ROI",
        value: simulation?.projected?.roi ?? null,
        unit: "",
        text: `日预算 ${money(account.budget)} → ${money(account.budget * (1 + delta / 100))} 元，预计支付金额变化 ${money(simulation?.projected?.incremental_revenue)} 元`,
      },
      riskLevel: action.riskLevel === "high" || riskForBudget(delta, scope.stockDays) === "high" ? "high" : action.riskLevel ?? riskForBudget(delta, scope.stockDays),
      riskText: action.riskText || (scope.stockDays !== null && scope.stockDays < 7 ? "库存偏低，请确认补货时间" : "请确认近期 ROI 与库存"),
    });
  }
  const plan = plans.find((item) => item.id === action.targetId);
  if (!plan) return { error: "计划不在当前商品工作区范围" };
  if (type === "plan_budget") {
    const delta = Number(action.deltaPct);
    if (!Number.isFinite(delta) || delta === 0) return { error: "计划预算幅度无效" };
    if (Math.abs(delta) > EXECUTION_GUARDRAILS.maxBudgetDeltaPct) return { error: "计划预算幅度超过护栏" };
    if (plan.status === "已结束") return { error: "计划已结束，不能调整预算" };
    const row = scope.planRows.find((item) => item.plan.id === plan.id);
    const before = round2(plan.budget);
    const after = round2(plan.budget * (1 + delta / 100));
    const highRisk =
      account.channel === "brand" ||
      (scope.stockDays !== null && scope.stockDays < 7) ||
      Math.abs(delta) > 10;
    const gaps = [...base.dataGaps];
    if (scope.stockDays !== null && scope.stockDays < 7 && !gaps.some((item) => item.includes("库存"))) {
      gaps.push("静态库存/补货时间需人工确认");
    }
    return createDecision({
      ...base,
      dataGaps: gaps,
      tool: "adjust_plan_budget",
      action: "调整计划预算",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "budget",
      before,
      after,
      unit: "元/日",
      reason,
      evidence: [
        ...evidence,
        `计划近7天消耗 ${money(row?.totals.cost ?? 0)}、支付 ${money(row?.totals.revenue ?? 0)}、ROI ${round2(scope.mock.roiOf(row?.totals ?? scope.accountTotals))}`,
        `计划预算 ${money(before)} → ${money(after)}，调整 ${delta > 0 ? "+" : ""}${delta}%`,
      ].slice(0, 4),
      expected: {
        label: "整体支付ROI",
        value: null,
        unit: "",
        text: `计划日预算 ${money(before)} → ${money(after)} 元，观察 3 天消耗与 ROI`,
      },
      riskLevel: highRisk ? "high" : "medium",
      riskText:
        action.riskText ||
        (account.channel === "brand"
          ? "品牌计划预算调整需确认品牌排期与承接"
          : scope.stockDays !== null && scope.stockDays < 7
            ? "库存偏低，请确认补货时间"
            : "请确认计划近期效率与预算使用率"),
    });
  }
  if (type === "bid") {
    const delta = Number(action.deltaPct);
    if (!Number.isFinite(delta) || delta === 0) return { error: "出价幅度无效" };
    if (Math.abs(delta) > EXECUTION_GUARDRAILS.maxBidDeltaPct) return { error: "出价幅度超过护栏" };
    const before = round2(plan.bid);
    const after = round2(plan.bid * (1 + delta / 100));
    return createDecision({
      ...base,
      tool: "adjust_bid",
      action: "调整出价",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "bid",
      before,
      after,
      unit: "元",
      reason,
      expected: { label: "整体支付ROI", value: null, unit: "", text: `出价 ${money(before)} → ${money(after)} 元，观察 3 天 ROI` },
      riskLevel: Math.abs(delta) > 10 ? "high" : action.riskLevel ?? "medium",
      riskText: action.riskText || "请确认计划仍在学习期内",
    });
  }
  if (type === "pause") {
    if (plan.status !== "投放中") return { error: "计划当前不是投放中" };
    return createDecision({
      ...base,
      tool: "pause_plan",
      action: "暂停计划",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "status",
      before: plan.status,
      after: "已暂停",
      unit: "",
      reason,
      expected: { label: "账户整体支付ROI", value: null, unit: "", text: "暂停后观察低效消耗是否收缩" },
      riskLevel: "high",
      riskText: action.riskText || "暂停动作影响较大，请确认",
    });
  }
  if (type === "resume") {
    if (plan.status !== "已暂停") return { error: "计划当前不是已暂停" };
    return createDecision({
      ...base,
      tool: "resume_plan",
      action: "恢复计划",
      targetType: "plan",
      targetId: plan.id,
      targetName: plan.name,
      field: "status",
      before: plan.status,
      after: "投放中",
      unit: "",
      reason,
      expected: { label: "账户整体支付ROI", value: null, unit: "", text: "恢复后观察 3 天消耗与 ROI" },
      riskLevel: "low",
      riskText: action.riskText || "恢复后可在审计中撤销",
    });
  }
  return { error: `不支持的动作：${type}` };
}

export async function proposeWorkspaceActions(input) {
  const scope = await buildScope(input.productId);
  if (!scope) return { ok: false, error: "商品不存在" };
  if (input.permission === "read") {
    return { ok: true, decisions: [], ask: "当前工作区是只读模式，不能提交执行提案。" };
  }
  const response = await chat({
    messages: [
      {
        role: "system",
        content:
          "你是 GETmore 商品工作区的执行规划器。你只负责把用户明确的执行请求整理成待确认动作，不执行任何操作。严格输出 JSON；数字和 ID 必须来自上下文。",
      },
      { role: "user", content: buildPrompt(scope, input) },
    ],
    temperature: 0.1,
    maxTokens: 1800,
    responseFormat: { type: "json_object" },
  });
  const parsed = parseJson(response.message?.content ?? "");
  if (process.env.HITL_DEBUG) console.log("[workspace-propose] raw:", response.message?.content);
  if (!parsed) return { ok: true, decisions: [], ask: "没有解析出可执行动作，请让优化师明确要调整的账户/计划和幅度。" };
  const actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, MAX_ACTIONS) : [];
  const decisions = [];
  const errors = [];
  for (const action of actions) {
    const result = decisionFromAction(scope, input, action, {});
    if (result?.ok && result.decision) decisions.push(result.decision);
    else if (result?.error) errors.push(result.error);
  }
  return {
    ok: true,
    decisions,
    ask: String(parsed.ask ?? "").slice(0, 500) || (errors.length ? errors.join("；") : ""),
  };
}
