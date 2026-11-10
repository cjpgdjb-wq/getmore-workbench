import { chat, chatStream, hasProvider, provider } from "./llm.mjs";
import {
  budgetPacing,
  categoryTrends,
  comparePeriods,
  normalizeRange,
  opportunityScan,
  orgSummary,
  portfolioBrief,
} from "./data-service.mjs";
import { EXPERTS, executeTool, expertById, toolSchemas } from "./tools.mjs";
import { callConnector } from "./connectors.mjs";
import { skillCatalogForPlanner, skillById, skillSummaryBlock } from "./skills.mjs";
import { routeSkills } from "./skill-router.mjs";
import { addMemory, memoryPromptBlock, retrieveMemory } from "./memory.mjs";
import { decorateMock, listOperations } from "./operations.mjs";
import { listDecisions, pendingCount } from "./decisions.mjs";
import { getRun, saveRun, uid as runUid } from "./runs.mjs";
import { buildTargetContext, neutralizeDirectionConflicts, reconcileActionCount, sanitizeClaims, WRITE_TOOL_SET } from "./guardrails.mjs";

const TOKEN_BUDGET = { l1: 720, l2: 560, l3: 640 };

const TOOL_LABELS = {
  get_market_trends: "查询类目趋势",
  get_audience_segments: "查询人群画像",
  find_opportunities: "扫描账户机会",
  query_accounts: "查询账户列表",
  query_plans: "查询计划明细",
  get_account_trend: "查询账户趋势",
  compare_periods: "对比周期表现",
  get_org_summary: "查询组织汇总",
  get_budget_pacing: "查询预算进度",
  get_account_plans: "查询账户计划",
  forecast_plan: "预测计划走势",
  load_skill: "加载技能",
  simulate_budget_change: "模拟预算调整",
  apply_budget_change: "提交预算调整",
  pause_plan: "提交暂停计划",
  resume_plan: "提交恢复计划",
  adjust_bid: "提交出价调整",
};

const estimateTokens = (text) => Math.ceil(String(text).length * 0.72);

function fitBudget(text, budget) {
  if (estimateTokens(text) <= budget) return { text, trimmed: false };
  const lines = text.split("\n");
  const kept = [];
  for (const line of lines) {
    if (estimateTokens([...kept, line].join("\n")) > budget - 24) break;
    kept.push(line);
  }
  return { text: `${kept.join("\n")}\n…（已按上下文预算裁剪）`, trimmed: true };
}

function nowLabel() {
  return new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function money(value) {
  return value === null || value === undefined ? "--" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function pct(value) {
  return value === null || value === undefined ? "--" : `${Number(value).toFixed(2)}%`;
}

function safeJsonParse(text) {
  if (!text) return null;
  const cleaned = String(text)
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

function firstParagraph(text) {
  return String(text ?? "")
    .replace(/[#>*`]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 12) ?? "";
}

/** 编排器兜底：凡涉及花钱动作，必须同时有分析与投放；涉及增长，必须有洞察 */
function ensureCoverage(plan, goal) {
  const text = String(goal);
  const ids = new Set(plan.experts.map((item) => item.id));
  const readOnlyIntent = /周报|只读/.test(text);
  if (readOnlyIntent) {
    plan.experts = plan.experts.filter((item) => item.id !== "ads");
    ids.delete("ads");
    if (!ids.has("analytics")) {
      plan.experts.unshift({ id: "analytics", focus: "汇总本周数据与变化，输出只读周报" });
      ids.add("analytics");
    }
  }
  const actionIntent = !readOnlyIntent && /预算|出价|暂停|加投|减投|roi|ROI|成本|订单|计划/.test(text);
  const growthIntent = /机会|新品|增长|人群|类目|竞品|赛道|趋势/.test(text);
  if (actionIntent && !ids.has("analytics")) {
    plan.experts.push({ id: "analytics", focus: "拆解目标账户的分层表现，量化加/减预算的影响" });
    ids.add("analytics");
  }
  if (actionIntent && !ids.has("ads")) {
    plan.experts.push({ id: "ads", focus: "基于分析结论提交可审批的预算/计划动作" });
    ids.add("ads");
  }
  if (growthIntent && !ids.has("opportunity")) {
    plan.experts.push({ id: "opportunity", focus: "寻找可验证的增量机会，给出人群/类目证据" });
    ids.add("opportunity");
  }
  plan.experts = plan.experts.slice(0, 3).map((item) => ({ ...item, focus: String(item.focus ?? "").slice(0, 60) }));
  return plan;
}

function keywordPlan(goal) {  const text = String(goal);
  const experts = [];
  if (/机会|新品|增长|人群|趋势|赛道|类目|竞品/.test(text)) experts.push("opportunity");
  if (/为什么|对比|分析|数据|归因|异常|下降|上升|复盘|诊断/.test(text)) experts.push("analytics");
  if (/预算|出价|暂停|投放|roi|ROI|成本|加投|减投|计划/.test(text)) experts.push("ads");
  if (!experts.length) experts.push("analytics", "ads");
  return {
    intent: text.slice(0, 80),
    experts: experts.map((id) => ({
      id,
      focus: id === "analytics" ? "定位关键指标变化与异常账户" : id === "ads" ? "给出可审批的预算/计划动作" : "寻找可验证的增量机会",
    })),
    successCriteria: ["结论引用具体数据", "给出可执行下一步", "动作需人工确认"],
    assumptions: ["使用当前看板周期与模拟数据"],
  };
}

/* ------------------------------------------------------------------ */
/* 分层上下文                                                          */
/* ------------------------------------------------------------------ */

function buildL1({ mock, range, brief, memoryHits, view }) {
  const preferences = memoryHits.filter((entry) => entry.kind === "preference");
  const outcomes = memoryHits.filter((entry) => entry.kind === "outcome");
  const decisions = memoryHits.filter((entry) => entry.kind === "decision");
  const lowBalance = mock.lowBalanceCount(mock.ACCOUNTS.filter((account) => account.channel === "auction"));
  const paused = mock.ACCOUNTS.filter((account) => account.channel === "auction" && account.status === "已暂停").length;

  const lines = [
    "【L1 全局经营上下文｜所有专家共享】",
    `日期：${nowLabel()}；统计周期：${range.start} ~ ${range.end}`,
    "服务商：A 公司（演示数据，代理服饰、美妆、食品、3C、家居、本地生活等多个商家）",
    "经营阶段：双 11 蓄水期第 2 周",
    "北极星目标：整体支付ROI ≥ 3.5，订单成本 ≤ 50 元，同时控制余额风险",
    `当前看板：${view?.channel === "brand" ? "品牌投放" : "竞价投放"} · ${view?.dimensionLabel ?? "账户"} · 组织 ${view?.orgName ?? "全部组织"}`,
    `组合大盘：竞价 ${brief.auction.accounts} 户，消耗 ${money(brief.auction.cost)}，支付 ${money(brief.auction.revenue)}，订单 ${brief.auction.orders}，ROI ${brief.auction.roi?.toFixed(2) ?? "--"}，订单成本 ${brief.auction.cpa?.toFixed(2) ?? "--"}`,
    `品牌大盘：${brief.brand.accounts} 户，消耗 ${money(brief.brand.cost)}，展示 ${money(brief.brand.shows)}，CTR ${brief.brand.ctr?.toFixed(2) ?? "--"}%，CPM ${brief.brand.cpm?.toFixed(2) ?? "--"}`,
    `风险信号：余额不足 ${lowBalance} 户，暂停 ${paused} 户`,
    `今日有消耗账户：${brief.auction.active_today} / ${brief.auction.accounts}`,
    `数据口径：整体支付ROI=支付金额/消耗；订单成本=消耗/订单数；品牌CTR=点击/展示`,
  ];
  if (decisions.length) {
    lines.push("历史决策：");
    for (const entry of decisions.slice(0, 3)) lines.push(`- ${entry.text}`);
  }
  if (outcomes.length) {
    lines.push("已验证结果（用于校准判断）：");
    for (const entry of outcomes.slice(0, 3)) lines.push(`- ${entry.text}（${entry.actual?.text ?? ""}）`);
  }
  if (preferences.length) {
    lines.push("用户偏好：");
    for (const entry of preferences.slice(0, 3)) lines.push(`- ${entry.text}`);
  }
  return fitBudget(lines.join("\n"), TOKEN_BUDGET.l1);
}

function buildL2({ expertId, mock, range, brief, categories, target }) {
  const shared = [];
  if (expertId === "opportunity") {
    shared.push("【L2 机会领域上下文】");
    shared.push(`重点类目：${categories.slice(0, 3).join("、") || "服饰生活"}`);
    for (const category of categories.slice(0, 2)) {
      const trend = categoryTrends(category, 14);
      shared.push(
        `- ${category}：热度 ${trend.heat_index}，14 天 ${trend.growth_pct >= 0 ? "+" : ""}${trend.growth_pct}%，竞品动作 ${trend.signals[1].value}`,
      );
    }
    const scan = opportunityScan(mock, { channel: "auction", range });
    shared.push(`机会扫描：共 ${scan.count} 个候选，Top3：`);
    for (const item of scan.opportunities.slice(0, 3)) {
      shared.push(`- [${item.type}] ${item.account}：${item.evidence}`);
    }
    shared.push("权限：只读趋势/人群/机会数据；不提交预算或出价动作。");
  } else if (expertId === "analytics") {
    shared.push("【L2 分析领域上下文】");
    shared.push("指标口径：消耗、支付金额、成交订单数、支付ROI=支付/消耗、订单成本=消耗/订单数；品牌侧看展示、点击率、CPM。");
    shared.push("可用维度：组织 / 账户 / 计划 / 类目 / 日期；可对比上一周期。");
    const compare = comparePeriods(mock, {}, range);
    shared.push(
      `大盘环比：消耗 ${compare.metrics.cost.delta_pct ?? "--"}%，支付 ${compare.metrics.revenue.delta_pct ?? "--"}%，ROI ${compare.metrics.roi.delta_pct ?? "--"}%，订单成本 ${compare.metrics.cpa.delta_pct ?? "--"}%`,
    );
    const orgs = orgSummary(mock, mock.ROOT_ORG_ID);
    shared.push(`组织表现：${orgs.orgs.map((org) => `${org.name} ROI ${org.roi?.toFixed(2) ?? "--"}`).join("；")}`);
    shared.push("权限：只读查询；不修改任何投放设置。");
  } else if (expertId === "ads") {
    shared.push("【L2 投放领域上下文｜全部账户可查询；写作用范围以 L3 为准】");
    const listed = [];
    for (const account of [
      ...(target?.accounts ?? []),
      target?.viewAccount ?? null,
      ...brief.top_accounts.map((row) => mock.accountById(row.id)),
    ]) {
      if (!account || listed.some((item) => item.id === account.id)) continue;
      listed.push(account);
      if (listed.length >= 4) break;
    }
    for (const account of listed) {
      const pacing = budgetPacing(mock, account.id);
      if (!pacing || pacing.error) continue;
      const accountTotals = mock.sumSeries(account.daily, range);
      shared.push(
        `- ${account.name}（account_id: ${account.id}）：日预算 ${money(pacing.daily_budget)}，今日消耗 ${money(pacing.today_cost)}（${pacing.today_pacing_pct ?? "--"}%），余额 ${money(pacing.balance)}，可支撑 ${pacing.runway_days ?? "--"} 天，近7天 ROI ${mock.roiOf(accountTotals)?.toFixed(2) ?? "--"}，授权 ${account.authorization}`,
      );
    }
    shared.push("护栏：单次预算调整 ≤ ±20%；出价调整 ≤ ±15%；预测 ROI 不得低于 2.5；余额 < 1000 元需先充值；品牌预算动作被拦截；单次任务最多 3 个动作。");
    shared.push("权限：只提交待确认动作，不直接执行；优化师确认后才写入操作审计。" );
    shared.push("注意：所有工具参数使用 account_id / plan_id，不要传账户名称；计划 ID 先用 get_account_plans 获取。");
    shared.push("说明：这里只列消耗 Top 与本次目标账户，不是“授权清单”；其它账户可直接用 query_accounts / get_account_plans 查询。");
    shared.push("数据缺口规则：账户缺净成交/退款授权或授权不完整时，只能观察/澄清，不能提交投放动作。");
  } else {
    shared.push("【L2 领域上下文】仅使用与任务相关的数据切片。");
  }
  return fitBudget(shared.join("\n"), TOKEN_BUDGET.l2);
}

function buildL3({ goal, plan, expert, focus, target }) {
  const lines = [
    "【L3 任务上下文｜本次任务】",
    `任务目标：${goal}`,
    target?.lines ? `\n${target.lines}\n` : "",
    `你的角色：${expert.name}（${expert.role}）`,
    `本次侧重：${focus || expert.role}`,
    `成功标准：${(plan.successCriteria ?? []).join("；") || expert.success}`,
    "输出要求：中文，180-260 字，结论先行；数字必须来自工具返回或【本次目标】，没有来源就写「未获取」；给出 1-2 条可执行建议。",
    expert.canWrite
      ? "边界：你不能直接修改投放。先查询/模拟，再调用 apply_budget_change / pause_plan / resume_plan / adjust_bid 提交待确认动作（每次最多 3 个）；没有成功的工具返回就不能写“已提交”，只能写“未提交”+原因。"
      : "边界：你只提出洞察/分析，不直接修改投放；如需动作，交给广告投放专家提交待确认动作。",
  ];
  return fitBudget(lines.join("\n"), TOKEN_BUDGET.l3);
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const PLANNER_PROMPT = `你是「巨量伙伴」的编排者，负责把商家的经营目标拆给最合适的专家。
可选专家：
- opportunity 机会洞察：市场趋势、人群、增量机会（只读）
- analytics 数据分析：指标归因、账户/计划下钻、环比（只读）
- ads 广告投放：预算/出价/计划动作（提交待优化师确认，有护栏、审计与撤销，出错代价最高）

只输出一个 JSON 对象，不要 markdown：
{
  "intent": "一句话概括用户真实意图",
  "experts": [{"id":"opportunity|analytics|ads","focus":"针对本次任务的具体分工"}],
  "skills": ["最多 2 个技能 id；没有合适的就空数组"],
  "successCriteria": ["可验证的成功标准"],
  "assumptions": ["必要假设"]
}
规则：
1. 涉及预算分配、账户取舍、加投/减投/暂停 → **必须同时包含 analytics 与 ads**（一个负责筛选归因，一个负责动作）。
2. 涉及“为什么/对比/归因/异常/复盘”且不涉及花钱动作 → analytics（可加 opportunity）。
3. 涉及新品/增长/人群/类目/竞品/机会 → 包含 opportunity。
4. 复杂经营任务可以是 2-3 个专家；不要机械地全选，也不要只选一个就结束。
5. focus 必须具体到本次目标，每条不超过 30 字，不要写通用职责。
6. skills 只从【可选技能】里选，按“当前目标是否真的需要这套方法”判断；技能是方法，不是工具；最多 2 个，宁缺毋滥。`;

function expertPrompt(expert, skillIds = null) {
  const persona = expert.persona ? `\n角色说明：${expert.persona}` : "";
  const base = `你是 GETmore 的「${expert.name}」专家，只对「${expert.role}」负责，向「巨量伙伴」汇报。${persona}
你和其他专家共享同一套 L1 全局上下文，但只加载自己的 L2 领域切片与 L3 任务切片。
你可以调用工具获取事实。**没有工具返回的数据，不要编造数字**。
只能引用工具返回或【本次目标】里的数字；缺什么就写「未获取」，禁止估算具体值。
用户口述前提（余额、ROI 等）与工具数据冲突时，先指出冲突，再以工具数据为准。
引用数字时保留口径（周期、账户、维度）。
不要复述上下文原文，直接给结论。
数据是演示用模拟数据，但请按真实经营口径分析。`;
  const skills = skillSummaryBlock(expert.id, skillIds);
  const baseWithSkills = skills ? `${base}\n\n${skills}` : base;
  if (expert.id === "opportunity") {
    return `${baseWithSkills}
你的判断标准：机会要能落到具体账户/人群/预算，且能在 3-7 天内被数据验证。
优先寻找：高 ROI 未打满、增量人群、类目上升、竞品动作带来的窗口。
不要给“多测试素材”这类空话；每条机会必须带证据与预期增量。`;
  }
  if (expert.id === "analytics") {
    return `${baseWithSkills}
你的判断标准：解释必须可下钻、可复核。至少调用一次查询工具，对比大盘/账户/计划。
优先回答：变化来自哪里（结构/计划/人群/花费）、影响多大、下一步该看什么。
不要越权给预算或出价动作；需要动作时只提示交给投放专家。`;
  }
  return `${baseWithSkills}
你的判断标准：动作要真实、可审批、ROI 不破底线、可审计可撤销。
你没有直接操作权限：所有写动作只提交给优化师确认，确认后才生效。
工作顺序：
1. 用 get_budget_pacing / get_account_plans 获取事实，account_id 必须使用上下文里的 ID。
2. 选 1-2 个候选账户，用 simulate_budget_change 验证幅度与预测 ROI。
3. 满足护栏时，调用 apply_budget_change / pause_plan / resume_plan / adjust_bid 提交待确认动作（每次任务最多 3 个），并写清楚“已提交待确认、变更前后是多少”。
4. 不要写“已执行”；只有系统确认后的操作才叫已执行。被护栏拦截时说明原因，不要重复提交。
5. 没有写工具的成功返回，就不能写“已提交/已创建”；工具报错或被拦截时，写“未提交”+原因。
6. 用户要的是计划级日预算、但系统没有该工具时，明确说明能力边界，再给替代方案（出价 ±15% 或账户预算），不要假装已提交。
7. 如果用户要求的幅度超过护栏，或被数据否定，不要用其它动作（账户预算、出价上探）变相满足；只能建议观察/澄清，或改用风险更低的方向（降预算、降出价、补授权）。
8. 预算重排只做 donor 降、recipient 升，总预算不变；不要建议新增预算。
9. 计划日均订单 < 10 单视为样本不足：必须指出，不能据此加预算/放量，只能建议观察或先扩样本。
10. 用户问“接下来怎么走 / 未来几天会怎样”时，先调用 forecast_plan；结论必须带预测区间、置信度、3 天后验证点和回滚条件。没有 forecast 结果就写“未获取”，不要自己拍趋势。
如果工具返回错误，不要重复用错误参数调用，改用正确的 account_id / plan_id。`;
}

const SYNTHESIS_PROMPT = `你是「巨量伙伴」的首席决策者，要把专家结论收敛成一份可执行的经营决策。
要求：
- 中文 Markdown，结论先行，不超过 450 字。
- 引用具体数字与账户/计划名称，不要复述专家原文。\n- 所有数字必须来自专家发现/工具结果；没有来源就写“--/未取到”，禁止编造环比、ROI、预算。
- 【本次目标事实】【动作事实】是权威；专家结论与之冲突时，以权威为准，并在 memo 里指出冲突。
- 用户口述前提（余额、ROI 等）与工具数据冲突时，必须指出冲突并以工具数据为准，不得迎合前提编造。
- 如果专家之间冲突，给出你的裁决理由。
- **投放动作由广告投放专家提交，等待优化师确认；本 memo 不能写“已执行”。** 用“已提交待确认 / 待优化师确认”描述动作，写清确认前后的变化。
- 只有【待优化师确认的动作】里的条目才算“已提交待确认”；只有【已确认的投放操作】才算“已执行”。两个清单都没有时，只能写“未提交/未执行”并说明原因。
- 待确认动作还没有被批准或驳回；你只能给优化师建议，不能替优化师写“已批准 / 已驳回 / 维持原预算已生效”这类完成时结论。
- 如果某项动作没有提交成功或没有执行，明确写「未提交 / 未执行」及原因，不要编造。
- 如果用户要求的幅度超过护栏，或被数据否定，不得用其它动作（账户预算、出价上探）变相满足；只能降级为观察/澄清，或给出风险更低的替代方案（降预算、降出价、补授权）。
- 预算重排必须满足“总预算不变”：先写 donor 降多少、再写 recipient 升多少；不得建议新增预算，除非用户明确允许加总预算。
- 涉及多个计划时逐个点名；同一计划不得同时出现“暂停”和“不暂停”两种结论。
- 计划日均订单 < 10 单时，必须指出「样本不足」，不能把 8 单/天当作可放量的证据。
- 涉及“未来 / 下一步 / 走势”的判断，必须引用 forecast_plan 的输出（区间 + 置信度 + 验证点）；没有就写“未获取”，不要自己编预测。
- 如果目标账户存在数据缺口（未授权/部分授权/延迟），必须说明“缺什么 → 影响什么 → 只能怎么做”。
- 给出 3 天后的验证指标与回滚建议。
- 结构固定：
### 结论
（1-2 句）
### 关键依据
（2-3 条，带数字）
### 执行方案
（1-3 条，按优先级；已提交动作写清变更前后，标注“待优化师确认”）
### 风险与验证
（1-2 句，说明 3 天后看什么指标验证）`;

/* ------------------------------------------------------------------ */
/* 工具结果摘要                                                        */
/* ------------------------------------------------------------------ */

function summarizeToolResult(toolName, result) {
  if (!result || typeof result !== "object") return "已返回结果";
  if (result.error) return `失败：${result.error}`;
  if (toolName === "load_skill") return `已加载技能：${result.name} v${result.version}`;
  if (toolName === "query_accounts") {
    return `${result.count} 个账户，消耗合计 ${money(result.totals?.cost)}，ROI ${result.totals?.roi ?? "--"}`;
  }
  if (toolName === "query_plans" || toolName === "get_account_plans") {
    return `${result.count} 个计划，Top：${result.plans?.[0]?.name ?? "--"}（消耗 ${money(result.plans?.[0]?.cost)}）`;
  }
  if (toolName === "get_account_trend") {
    return `${result.name} 近 ${result.days} 天消耗 ${money(result.summary?.cost)}，支付 ${money(result.summary?.revenue)}`;
  }
  if (toolName === "compare_periods") {
    return `消耗 ${result.metrics?.cost?.delta_pct ?? "--"}%，支付 ${result.metrics?.revenue?.delta_pct ?? "--"}%，ROI ${result.metrics?.roi?.delta_pct ?? "--"}%`;
  }
  if (toolName === "get_org_summary") {
    return `${result.org}：${result.orgs?.length ?? 0} 个子组织`;
  }
  if (toolName === "get_market_trends") {
    return `${result.category} 热度 ${result.heat_index}，增长 ${result.growth_pct}%`;
  }
  if (toolName === "get_audience_segments") {
    return `${result.segments?.length ?? 0} 个高潜人群，Top：${result.segments?.[0]?.name ?? "--"}`;
  }
  if (toolName === "find_opportunities") {
    return `发现 ${result.count} 个机会，Top：${result.opportunities?.[0]?.title ?? "--"}`;
  }
  if (toolName === "get_budget_pacing") {
    return `${result.account}：今日进度 ${result.today_pacing_pct ?? "--"}%，余额 ${money(result.balance)}`;
  }
  if (toolName === "simulate_budget_change") {
    return `预测 ROI ${result.projected?.roi ?? "--"}，增量支付 ${money(result.projected?.incremental_revenue)}`;
  }
  if (["apply_budget_change", "pause_plan", "resume_plan", "adjust_bid"].includes(toolName)) {
    if (result.ok) return result.message ?? "动作已提交，等待优化师确认";
    return `未提交：${(result.violations ?? []).join("；") || result.error || result.message || "被护栏拦截"}`;
  }
  return JSON.stringify(result).slice(0, 180);
}

/* ------------------------------------------------------------------ */
/* 专家执行                                                            */
/* ------------------------------------------------------------------ */

async function runExpert({ expert, plan, focus, goal, l1, l2, l3, ctx, emit, skillIds }) {
  const startedAt = Date.now();
  const aggregatedUsage = { prompt_tokens: 0, completion_tokens: 0 };
  const toolTraces = [];
  emit({
    type: "expert_start",
    expert: { id: expert.id, name: expert.name, role: expert.role, color: expert.color, canWrite: expert.canWrite },
    focus,
    context_tokens: estimateTokens(`${l1}\n${l2}\n${l3}`),
    startedAt,
  });

  const messages = [
    { role: "system", content: expertPrompt(expert, skillIds) },
    { role: "user", content: `${l1}\n\n${l2}\n\n${l3}` },
  ];
  const tools = toolSchemas(expert.id);
  let finalText = "";
  let error = null;
  const maxRounds = expert.id === "ads" ? 6 : 4;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const response = await chat({
        messages,
        tools,
        temperature: 0.3,
        maxTokens: 1600,
      });
      aggregatedUsage.prompt_tokens += response.usage.prompt_tokens ?? 0;
      aggregatedUsage.completion_tokens += response.usage.completion_tokens ?? 0;
      const message = response.message ?? {};
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length) {
        messages.push({
          role: "assistant",
          content: message.content ?? "",
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const callId = call.id ?? `${expert.id}-${toolTraces.length}`;
          let args = {};
          try {
            args = JSON.parse(call.function?.arguments ?? "{}");
          } catch {
            args = {};
          }
          const toolName = call.function?.name ?? "unknown";
          const toolStarted = Date.now();
          emit({
            type: "tool_call",
            expertId: expert.id,
            id: callId,
            tool: toolName,
            label: TOOL_LABELS[toolName] ?? toolName,
            args,
          });
          const execution =
            toolName === "load_skill"
              ? await executeTool(expert.id, toolName, args, ctx)
              : await callConnector(expert.id, toolName, args, ctx);
          // MCP 在子进程里创建 Decision，父进程补发实时事件，UI 才能立刻出现待确认卡片。
          if (execution.meta?.transport === "mcp" && execution.result?.decision) {
            emit({ type: "decision_created", decision: execution.result.decision });
          }
          const summary = execution.ok ? summarizeToolResult(toolName, execution.result) : execution.error;
          const detail = JSON.stringify(execution.ok ? execution.result : { error: execution.error }).slice(0, 2600);
          toolTraces.push({
            id: callId,
            tool: toolName,
            label: TOOL_LABELS[toolName] ?? toolName,
            args,
            ok: execution.ok,
            summary,
            durationMs: Date.now() - toolStarted,
          });
          emit({
            type: "tool_result",
            expertId: expert.id,
            id: callId,
            ok: execution.ok,
            summary,
            detail,
            durationMs: Date.now() - toolStarted,
          });
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify(execution.ok ? execution.result : { error: execution.error }).slice(0, 7000),
          });
        }
        if (
          expert.id === "ads" &&
          round >= 1 &&
          listOperations({ runId: ctx.runId }).length === 0 &&
          pendingCount(ctx.runId) === 0 &&
          ctx.expectsAction &&
          !ctx.writeBlocked
        ) {
          messages.push({
            role: "user",
            content:
              "提醒：若本次存在合规动作，请调用 apply_budget_change / pause_plan / resume_plan / adjust_bid 提交 1-2 个待确认动作；若因授权/护栏/数据缺口无法提交，直接写「未提交」+原因，禁止声称已提交。",
          });
        }
        continue;
      }
      finalText = String(message.content ?? "").trim();
      break;
    }

    if (!finalText) {
      const fallback = await chat({
        messages: [
          ...messages,
          { role: "user", content: "请基于已经拿到的工具结果，直接输出 150 字以内的结论，不要再调用工具。" },
        ],
        tools,
        toolChoice: "none",
        temperature: 0.2,
        maxTokens: 1200,
      });
      aggregatedUsage.prompt_tokens += fallback.usage.prompt_tokens ?? 0;
      aggregatedUsage.completion_tokens += fallback.usage.completion_tokens ?? 0;
      finalText = String(fallback.message?.content ?? "").trim();
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "专家执行失败";
    emit({ type: "expert_error", expertId: expert.id, message: error });
  }

  const rawFinding = finalText || (error ? `执行失败：${error}` : "未返回结论");
  const hasSubmitted = toolTraces.some((trace) => trace.ok && WRITE_TOOL_SET.has(trace.tool));
  const claimFix = sanitizeClaims(rawFinding, { submitted: hasSubmitted, executed: false });
  const finding = claimFix.changed
    ? `${claimFix.text}\n\n（系统校验：本轮${hasSubmitted ? "动作只有待确认记录，尚未执行" : "没有成功的写工具返回"}，已完成表述已按实际状态更正。）`
    : claimFix.text;
  const latencyMs = Date.now() - startedAt;
  emit({
    type: "expert_end",
    expertId: expert.id,
    finding,
    tools: toolTraces,
    usage: aggregatedUsage,
    latencyMs,
    error,
  });
  return {
    expert,
    focus,
    finding,
    tools: toolTraces,
    usage: aggregatedUsage,
    latencyMs,
    error,
    claimAdjusted: claimFix.changed,
  };
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

export async function runPartner({ goal, view, emit, signal }) {
  if (!hasProvider()) {
    throw new Error("未配置模型 API Key，无法启动多专家任务");
  }

  const mock = await import("./mock.mjs").then((mod) => mod.loadMock());
  const state = decorateMock(mock);
  const range = normalizeRange(mock, view?.range);
  const brief = portfolioBrief(state, range);
  const target = buildTargetContext({ mock: state, goal, view, range });
  const runId = runUid("run");
  const startedAt = Date.now();
  const startedIso = new Date().toISOString();
  const events = [];
  const safeEmit = (event) => {
    events.push(event);
    if (signal?.aborted) return;
    try {
      emit?.(event);
    } catch {
      /* client disconnected */
    }
  };

  safeEmit({
    type: "run_start",
    runId,
    goal,
    startedAt: startedIso,
    model: provider.model,
    range,
    execution: { mode: "direct", label: "已授权直接操作（模拟）" },
  });

  const memoryHits = retrieveMemory({
    text: goal,
    accountId: view?.accountId ?? null,
    category: view?.category ?? null,
    limit: 6,
  });
  const categories = Array.from(
    new Set(
      state.ACCOUNTS.filter((account) => account.channel === "auction")
        .map((account) => {
          const name = account.name;
          if (/初见/.test(name)) return "美妆个护";
          if (/简味|源本|元气/.test(name)) return "食品饮料";
          if (/星野|潮玩/.test(name)) return "数码潮玩";
          if (/沐野/.test(name)) return "户外运动";
          if (/轻氧|禾颂/.test(name)) return "家居家纺";
          if (/花间集|拾光/.test(name)) return "服饰生活";
          return "本地生活";
        })
        .filter(Boolean),
    ),
  );

  const l1 = buildL1({ mock: state, range, brief, memoryHits, view });
  safeEmit({
    type: "context_l1",
    layer: {
      key: "L1",
      label: "全局经营上下文",
      tokens: estimateTokens(l1.text),
      budget: TOKEN_BUDGET.l1,
      trimmed: l1.trimmed,
      preview: l1.text.slice(0, 180),
      content: l1.text,
    },
    memoryHits: memoryHits.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      score: entry.score,
    })),
  });

  /* 1. 规划 */
  const skillCatalog = skillCatalogForPlanner();
  const skillCatalogText = skillCatalog
    .map(
      (skill) =>
        `- ${skill.id}｜${skill.name}｜${skill.description}｜适用专家：${(skill.expertIds ?? []).join("/")}｜触发：${(skill.triggers ?? []).join("/")}`,
    )
    .join("\n");
  const planMessages = [
    { role: "system", content: PLANNER_PROMPT },
    {
      role: "user",
      content: `【经营目标】${goal}\n\n【L1 上下文】\n${l1.text}\n\n【相关记忆】\n${memoryPromptBlock(memoryHits)}\n\n【可选技能】\n${skillCatalogText || "（无）"}`,
    },
  ];
  let plan = null;
  let planUsage = {};
  try {
    const response = await chat({
      messages: planMessages,
      responseFormat: { type: "json_object" },
      temperature: 0.2,
      maxTokens: 900,
    });
    planUsage = response.usage;
    plan = safeJsonParse(response.message?.content);
  } catch (err) {
    safeEmit({ type: "notice", level: "warn", message: `规划调用失败，使用关键词路由：${err.message}` });
  }

  if (!plan || !Array.isArray(plan.experts) || plan.experts.length === 0) {
    plan = keywordPlan(goal);
  }
  const validExperts = plan.experts
    .map((item) => ({ ...item, expert: expertById(item.id) }))
    .filter((item) => Boolean(item.expert));
  plan.experts = validExperts.length
    ? validExperts.map((item) => ({ id: item.id, focus: String(item.focus ?? "").slice(0, 120) }))
    : keywordPlan(goal).experts;
  plan.successCriteria = Array.isArray(plan.successCriteria) ? plan.successCriteria.slice(0, 4) : [];
  plan.assumptions = Array.isArray(plan.assumptions) ? plan.assumptions.slice(0, 4) : [];
  plan = ensureCoverage(plan, goal);
  // WorkBuddy 式：planner 先看技能摘要选技能；没给或全无效时回退关键词路由。
  const plannerSkillIds = Array.isArray(plan.skills)
    ? [...new Set(plan.skills.map(String).filter(Boolean))].slice(0, 2)
    : null;
  const selectedExpertIds = new Set(plan.experts.map((item) => item.id));
  let skillRoute;
  if (plannerSkillIds !== null) {
    const selected = plannerSkillIds
      .map((id) => skillById(id))
      .filter((skill) => Boolean(skill))
      .filter((skill) => (skill.expertIds ?? []).some((id) => selectedExpertIds.has(id)));
    if (!selected.length && plannerSkillIds.length > 0) {
      skillRoute = { ...routeSkills(goal), reason: "planner 技能无效，回退关键词路由" };
    } else {
      skillRoute = {
        skills: selected,
        skillIds: selected.map((skill) => skill.id),
        reason: selected.length ? "planner 选择技能" : "planner 未选择技能",
        matchedBy: "planner",
        candidates: plannerSkillIds,
      };
    }
  } else {
    skillRoute = routeSkills(goal);
  }
  plan.skills = skillRoute.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    version: skill.version,
    reason: skillRoute.reason,
  }));
  plan.skillRoute = {
    reason: skillRoute.reason,
    matchedBy: skillRoute.matchedBy,
    candidates: skillRoute.candidates,
  };
  safeEmit({
    type: "skill_route",
    skills: plan.skills,
    reason: skillRoute.reason,
    matchedBy: skillRoute.matchedBy,
    candidates: skillRoute.candidates,
  });

  safeEmit({
    type: "plan",
    plan: {
      intent: String(plan.intent ?? goal).slice(0, 160),
      experts: plan.experts.map((item) => {
        const expert = expertById(item.id);
        return { id: item.id, name: expert?.name, role: expert?.role, focus: item.focus };
      }),
      skills: plan.skills,
      successCriteria: plan.successCriteria,
      assumptions: plan.assumptions,
    },
    usage: planUsage,
  });

  /* 2. 组装上下文 */
  const l3ByExpert = {};
  const l2ByExpert = {};
  const layers = [];
  for (const item of plan.experts) {
    const expert = expertById(item.id);
    if (!expert) continue;
    const l2 = buildL2({ expertId: expert.id, mock: state, range, brief, categories, target });
    const l3 = buildL3({ goal, plan, expert, focus: item.focus, target });
    l2ByExpert[expert.id] = l2;
    l3ByExpert[expert.id] = l3;
    layers.push({
      key: "L2",
      expertId: expert.id,
      expertName: expert.name,
      label: `${expert.name} · 领域切片`,
      tokens: estimateTokens(l2.text),
      budget: TOKEN_BUDGET.l2,
      trimmed: l2.trimmed,
      preview: l2.text.slice(0, 160),
      content: l2.text,
    });
    layers.push({
      key: "L3",
      expertId: expert.id,
      expertName: expert.name,
      label: `${expert.name} · 任务切片`,
      tokens: estimateTokens(l3.text),
      budget: TOKEN_BUDGET.l3,
      trimmed: l3.trimmed,
      preview: l3.text.slice(0, 140),
      content: l3.text,
    });
  }
  safeEmit({ type: "context", layers });

  /* 3. 专家并行执行 */
  const context = {
    runId,
    mock: state,
    baseMock: mock,
    range,
    channel: view?.channel === "brand" ? "brand" : "auction",
    accountId: view?.accountId ?? null,
    requestedTargets: target.scope,
    expectsAction: target.expectsAction,
    writeBlocked: target.writeBlocked,
    emit: safeEmit,
  };

  const expertRuns = plan.experts.map((item) => {
    const expert = expertById(item.id);
    return runExpert({
      expert,
      plan,
      focus: item.focus,
      goal,
      l1: l1.text,
      l2: l2ByExpert[item.id].text,
      l3: l3ByExpert[item.id].text,
      ctx: context,
      emit: safeEmit,
      skillIds: skillRoute.skillIds,
    });
  });
  const expertResults = (await Promise.allSettled(expertRuns)).map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const expert = expertById(plan.experts[index].id);
    return {
      expert,
      focus: plan.experts[index].focus,
      finding: `专家执行失败：${result.reason instanceof Error ? result.reason.message : "未知错误"}`,
      tools: [],
      usage: {},
      latencyMs: 0,
      error: true,
    };
  });

  /* 4. 综合决策 */
  const operations = listOperations({ runId });
  const pendingDecisions = listDecisions({ runId, status: "pending" });
  safeEmit({ type: "synthesis_start" });
  const expertBlock = expertResults
    .map(
      (result) =>
        `【${result.expert?.name ?? "专家"}｜${result.focus ?? ""}】\n${String(result.finding).slice(0, 1400)}\n工具调用：${
          result.tools.map((tool) => `${tool.label}（${tool.ok ? "成功" : "失败"}）`).join("、") || "无"
        }`,
    )
    .join("\n\n");
  const operationBlock = operations.length
    ? operations
        .map(
          (operation) =>
            `- 已确认：${operation.target_name} 的${operation.field === "status" ? "状态" : operation.field === "budget" ? "日预算" : "出价"} ${operation.before}${operation.unit ? ` ${operation.unit}` : ""} → ${operation.after}${operation.unit ? ` ${operation.unit}` : ""}；理由：${operation.reason}；预期：${operation.expected?.text ?? "待验证"}`,
        )
        .join("\n")
    : "（本任务没有已确认的投放动作）";
  const pendingBlock = pendingDecisions.length
    ? pendingDecisions
        .map(
          (decision) =>
            `- 待确认：${decision.targetName} 的${decision.field === "status" ? "状态" : decision.field === "budget" ? "日预算" : "出价"} ${decision.before}${decision.unit ? ` ${decision.unit}` : ""} → ${decision.after}${decision.unit ? ` ${decision.unit}` : ""}；理由：${decision.reason}；风险：${decision.riskText || decision.riskLevel}`,
        )
        .join("\n")
    : "（没有待确认动作）";

  const writeTraces = expertResults
    .flatMap((result) => result.tools ?? [])
    .filter((tool) => tool.ok && WRITE_TOOL_SET.has(tool.tool));
  const actionFacts = writeTraces.length
    ? writeTraces.map((tool) => `- 写工具成功：${tool.label}｜${tool.summary}`).join("\n")
    : "（本轮没有任何成功的写工具调用。禁止写“已提交/已执行”，只能写“未提交/未执行”+原因）";

  const synthesisMessages = [
    { role: "system", content: SYNTHESIS_PROMPT },
    {
      role: "user",
      content: `【经营目标】${goal}\n\n【本次目标事实（系统解析，权威）】\n${target.lines}\n\n【L1 上下文】\n${l1.text}\n\n【专家结论】\n${expertBlock}\n\n【动作事实（系统记录，权威）】\n${actionFacts}\n\n【已确认的投放操作】\n${operationBlock}\n\n【待优化师确认的动作】\n${pendingBlock}\n\n请输出最终决策 memo。`,
    },
  ];

  let synthesisText = "";
  let synthesisUsage = {};
  try {
    const streamed = await chatStream({
      messages: synthesisMessages,
      temperature: 0.35,
      maxTokens: 2800,
      onDelta: (delta) => safeEmit({ type: "delta", text: delta }),
    });
    synthesisText = streamed.text.trim();
    synthesisUsage = streamed.usage;
  } catch (err) {
    synthesisText = "综合决策生成失败，请参考上方专家结论。";
    safeEmit({ type: "error", message: err instanceof Error ? err.message : "综合决策失败" });
  }

  if (!synthesisText) {
    synthesisText = [
      "### 结论",
      "本轮综合结论生成不完整，以下为专家发现与待确认动作汇总。",
      "### 专家发现",
      ...expertResults.map((result) => `- **${result.expert?.name ?? "专家"}**：${firstParagraph(result.finding)}`),
      "### 风险与验证",
      "3 天后回看整体 ROI、订单成本与账户余额变化；确认后的动作可在操作审计中撤销。",
    ].join("\n");
    safeEmit({ type: "delta", text: synthesisText });
  }

  const directionFix = neutralizeDirectionConflicts(synthesisText);
  if (directionFix.changed) {
    synthesisText = directionFix.text;
    safeEmit({ type: "notice", level: "warn", message: "合成结论中出现「方向词与变更前后数值相反」的表述，已把方向词改为中性表述" });
  }

  const hasSubmitted = pendingDecisions.length + operations.length > 0;
  const hasExecuted = operations.length > 0;
  const synthesisClaimFix = sanitizeClaims(synthesisText, { submitted: hasSubmitted, executed: hasExecuted });
  if (synthesisClaimFix.changed) {
    synthesisText = synthesisClaimFix.text;
    safeEmit({
      type: "notice",
      level: "warn",
      message: "合成结论中的提交/执行状态与实际动作记录不一致，已按实际状态更正",
    });
  }

  const actionCountFix = reconcileActionCount(synthesisText, { pending: pendingDecisions.length });
  if (actionCountFix.changed) {
    synthesisText = actionCountFix.text;
    safeEmit({
      type: "notice",
      level: "warn",
      message: "合成结论中的动作数量与待确认清单不一致，已按清单更正",
    });
  }

  /* 5. 记忆写回 */
  const preferenceRegex = [
    { pattern: /(?:ROI|roi)[^\d]{0,8}([0-9]+(?:\.[0-9]+)?)/, make: (match) => `该商家要求整体支付ROI 不低于 ${match[1]}` },
    { pattern: /预算[^\d]{0,6}([0-9]+(?:\.[0-9]+)?)\s*(万|w)/i, make: (match) => `该商家预算上限约 ${match[1]} 万` },
    { pattern: /不要[^\n]{0,12}(暂停|降价|关停)/, make: (match) => `该商家对「${match[1]}」类动作较谨慎，需人工复核` },
  ];
  const memoryEntries = [];
  const decisionText = `${String(plan.intent).replace(/[。.\s]+$/, "")}。${firstParagraph(synthesisText)}`.slice(0, 420);
  memoryEntries.push({
    kind: "decision",
    scope: "global",
    text: decisionText,
    evidence: expertResults.map((result) => firstParagraph(result.finding)).join(" / ").slice(0, 400),
    goal,
    run_id: runId,
    tags: Array.from(new Set(String(goal).split(/[\s，。；、,.]/).filter((word) => word.length >= 2))).slice(0, 6),
    expected: operations[0]?.expected
      ? {
          label: operations[0].expected.label,
          value: operations[0].expected.value ?? null,
          unit: operations[0].expected.unit ?? "",
        }
      : { label: "经营判断", value: null, text: "3 天后回看专家结论是否成立" },
  });
  for (const rule of preferenceRegex) {
    const match = String(goal).match(rule.pattern);
    if (match) {
      memoryEntries.push({
        kind: "preference",
        scope: "global",
        text: rule.make(match),
        evidence: `来自本次任务目标：${goal.slice(0, 120)}`,
        goal,
        run_id: runId,
        tags: ["偏好", "目标"],
        expected: null,
      });
      break;
    }
  }
  let storedMemories = [];
  if (memoryEntries.length) {
    storedMemories = addMemory(memoryEntries.slice(0, 3));
    safeEmit({ type: "memory_write", entries: storedMemories });
  }

  const latencyMs = Date.now() - startedAt;
  const usage = {
    planner: planUsage,
    experts: expertResults.reduce(
      (acc, result) => ({
        prompt_tokens: acc.prompt_tokens + (result.usage?.prompt_tokens ?? 0),
        completion_tokens: acc.completion_tokens + (result.usage?.completion_tokens ?? 0),
      }),
      { prompt_tokens: 0, completion_tokens: 0 },
    ),
    synthesis: synthesisUsage,
  };

  const run = {
    id: runId,
    goal,
    createdAt: startedAt,
    startedAt: startedIso,
    status: "completed",
    model: provider.model,
    view: view ?? null,
    range,
    plan,
    context: {
      l1: l1.text,
      l2: l2ByExpert,
      l3: l3ByExpert,
      layers,
      target: target.lines,
    },
    target: {
      accounts: target.accounts.map((account) => ({ id: account.id, name: account.name, authorization: account.authorization })),
      plans: target.plans.map((plan) => ({ id: plan.id, name: plan.name, accountId: plan.accountId })),
      invalid: target.invalid,
      writeBlocked: target.writeBlocked,
      expectsAction: target.expectsAction,
      scope: target.scope,
    },
    experts: expertResults.map((result) => ({
      id: result.expert?.id ?? "unknown",
      name: result.expert?.name ?? "专家",
      role: result.expert?.role ?? "",
      focus: result.focus,
      finding: result.finding,
      tools: result.tools,
      claimAdjusted: Boolean(result.claimAdjusted),
      usage: result.usage,
      latencyMs: result.latencyMs,
      error: Boolean(result.error),
    })),
    synthesis: synthesisText,
    claimGuards: expertResults
      .filter((result) => result.claimAdjusted)
      .map((result) => result.expert?.id ?? "unknown")
      .concat(synthesisClaimFix.changed ? ["synthesis:claims"] : [])
      .concat(actionCountFix.changed ? ["synthesis:action-count"] : [])
      .concat(directionFix.changed ? ["synthesis:direction"] : []),
    operations,
    decisions: listDecisions({ runId }),
    memories: storedMemories,
    usage,
    latencyMs,
    memoryHits: memoryHits.map((entry) => ({ id: entry.id, kind: entry.kind, text: entry.text, score: entry.score })),
  };
  saveRun(run);

  safeEmit({
    type: "run_end",
    runId,
    latencyMs,
    usage,
    memoryIds: storedMemories.map((entry) => entry.id),
    operationIds: operations.map((operation) => operation.id),
    decisionIds: listDecisions({ runId }).map((decision) => decision.id),
  });

  return { run, events };
}

export { getRun, saveRun };

