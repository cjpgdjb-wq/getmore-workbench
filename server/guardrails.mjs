/**
 * 目标解析与数据缺口门禁：把「用户这次到底要动谁」变成权威事实，
 * 并据此约束写动作与后续综合结论。
 *
 * 背景：评测发现 Agent 会把 L2 里「消耗 Top 3 账户」误当成「已授权账户清单」，
 * 进而宣称目标计划不在授权范围、编造计划数据，或把动作挪到别的账户。
 */
import { findAccount, findCampaign } from "./data-service.mjs";

export const WRITE_TOOLS = ["apply_budget_change", "pause_plan", "resume_plan", "adjust_bid"];
export const WRITE_TOOL_SET = new Set(WRITE_TOOLS);

const ACTION_INTENT = /加预算|提高预算|上调|降预算|下调|暂停|恢复|调整|出价|加投|减投|放量|扩量|预算|止损|重排|挪/;
const OBSERVE_INTENT = /只观察|不要动|别动|先别|能不能|是否|评估一下|判断一下|只读/;

const money = (value) =>
  value === null || value === undefined ? "--" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const round2 = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);

/** 账户级数据缺口：缺失/未授权的数据源、授权状态、报表延迟 */
export function accountGaps(account) {
  if (!account) return { gaps: [], blocking: false };
  const sources = Array.isArray(account.dataSources) ? account.dataSources : [];
  const gaps = [];
  if (!sources.includes("商品交易")) gaps.push("净成交/退款未授权（商品交易数据缺失）");
  if (account.authorization && account.authorization !== "已授权") gaps.push(`授权状态：${account.authorization}`);
  if (Number(account.dataLagMinutes) > 10) gaps.push(`报表延迟 ${account.dataLagMinutes} 分钟`);
  const blocking = !sources.includes("商品交易") || (account.authorization && account.authorization !== "已授权");
  return { gaps, blocking };
}

/**
 * 写动作门禁：目标账户存在阻断性数据缺口时，不允许提交任何投放动作。
 * 返回 null 表示放行。
 */
export function writeGate(mock, targetType, targetId) {
  let account = null;
  let label = String(targetId ?? "");
  if (targetType === "account") {
    account = findAccount(mock, targetId);
    label = account?.name ?? label;
  } else {
    const plan = findCampaign(mock, targetId);
    account = plan ? mock.accountById(plan.accountId) : null;
    label = plan?.name ?? label;
  }
  if (!account) return null;
  const { gaps, blocking } = accountGaps(account);
  if (!blocking) return null;
  return {
    blocked: true,
    gaps,
    message: `目标「${label}」所属账户「${account.name}」存在数据缺口：${gaps.join("；")}。按数据缺口规则，本轮只能观察/澄清或先补授权，不能提交投放动作。`,
  };
}

function accountFacts(mock, account, range) {
  const totals = mock.sumSeries(account.daily, range);
  const last7 = account.daily.slice(-7);
  const cost7 = last7.reduce((sum, point) => sum + point.cost, 0);
  const runway = cost7 > 0 ? round2(account.balance / (cost7 / 7)) : null;
  return `- 账户：${account.name}（account_id ${account.id}）｜${account.status}｜授权 ${account.authorization}｜报表延迟 ${account.dataLagMinutes} 分钟｜日预算 ${money(account.budget)}｜余额 ${money(account.balance)}｜近7天 消耗 ${money(totals.cost)} / ROI ${round2(mock.roiOf(totals)) ?? "--"} / 订单成本 ${round2(mock.cpaOf(totals)) ?? "--"}｜可支撑 ${runway ?? "--"} 天`;
}

function planFacts(mock, plan, range) {
  const totals = mock.sumSeries(plan.daily, range);
  const owner = mock.accountById(plan.accountId);
  const days = Math.max(
    1,
    (mock.DATE_KEYS ?? []).filter((date) => date >= range.start && date <= range.end).length || 7,
  );
  return `- 计划：${plan.name}（plan_id ${plan.id}，所属 ${owner?.name ?? "--"} ${plan.accountId}）｜${plan.status} / ${plan.mode}·${plan.target}｜日预算 ${money(plan.budget)}｜出价 ${money(plan.bid)}｜近7天 消耗 ${money(totals.cost)} / 订单 ${Math.round(totals.orders)}（日均 ${(totals.orders / days).toFixed(1)}） / ROI ${round2(mock.roiOf(totals)) ?? "--"} / 订单成本 ${round2(mock.cpaOf(totals)) ?? "--"}`;
}

/**
 * 解析本次任务的目标账户/计划，生成权威事实块与写作用范围。
 * 只认显式目标（account_id/plan_id 或账户/计划全名）；没有显式目标时不扩大写作用范围。
 */
export function buildTargetContext({ mock, goal, view, range }) {
  const text = String(goal ?? "");
  const campaigns = [...(mock.CAMPAIGNS ?? []), ...(mock.BRAND_CAMPAIGNS ?? [])];
  const accounts = [];
  const plans = [];
  const invalid = [];
  const seenAccount = new Set();
  const seenPlan = new Set();
  const explicitAccountIds = new Set();

  const addAccount = (ref, { explicit = true } = {}) => {
    const account = findAccount(mock, ref);
    if (!account) {
      invalid.push(String(ref));
      return;
    }
    if (explicit) explicitAccountIds.add(account.id);
    if (seenAccount.has(account.id)) return;
    seenAccount.add(account.id);
    accounts.push(account);
  };
  const addPlan = (ref) => {
    const plan = findCampaign(mock, ref);
    if (!plan) {
      invalid.push(String(ref));
      return;
    }
    if (seenPlan.has(plan.id)) return;
    seenPlan.add(plan.id);
    plans.push(plan);
    addAccount(plan.accountId, { explicit: false });
  };

  for (const match of text.matchAll(/account_id\s*[=:：]\s*([0-9A-Za-z_-]+)/g)) addAccount(match[1]);
  for (const match of text.matchAll(/plan_id\s*[=:：]\s*([0-9A-Za-z_-]+)/g)) addPlan(match[1]);
  for (const account of mock.ACCOUNTS ?? []) if (text.includes(account.name)) addAccount(account.id);
  for (const campaign of campaigns) if (text.includes(campaign.name)) addPlan(campaign.id);

  const viewAccount = view?.accountId ? findAccount(mock, view.accountId) : null;
  const explicit = accounts.length > 0 || plans.length > 0;

  const scopeAccountIds = [...explicitAccountIds];
  const scopePlanIds = plans.map((plan) => plan.id);
  // 只点名账户时，允许对该账户内的计划动作；点名计划时，只允许该计划（不允许用账户预算变相满足计划级诉求）。
  if (scopePlanIds.length === 0) {
    for (const account of accounts) {
      for (const campaign of campaigns.filter((item) => item.accountId === account.id)) {
        if (!scopePlanIds.includes(campaign.id)) scopePlanIds.push(campaign.id);
      }
    }
  }

  const gaps = accounts.map((account) => ({ account, ...accountGaps(account) }));
  const blocking = gaps.filter((item) => item.blocking);
  const writeBlocked = blocking.length > 0;

  const lines = ["【本次目标（系统解析，权威；与专家推测冲突时以此为准）】"];
  if (invalid.length) {
    lines.push(
      `- 用户指定的目标不存在：${invalid.join("、")}。只能向用户澄清，不得编造该目标的数据，也不得对其它目标提交动作。`,
    );
  }
  for (const account of accounts) lines.push(accountFacts(mock, account, range));
  for (const plan of plans) {
    lines.push(planFacts(mock, plan, range));
    const totals = mock.sumSeries(plan.daily, range);
    const days = Math.max(
      1,
      (mock.DATE_KEYS ?? []).filter((date) => date >= range.start && date <= range.end).length || 7,
    );
    const ordersPerDay = totals.orders / days;
    if (ordersPerDay < 10) {
      lines.push(
        `- 样本量：该计划近7天 ${Math.round(totals.orders)} 单（约 ${ordersPerDay.toFixed(1)} 单/天）→ 样本不足，不能据此加预算/放量；只能观察或先扩样本。`,
      );
    }
  }
  if (accounts.length >= 2 && /挪|转移|重排|调拨|搬/.test(text)) {
    const rows = accounts
      .map((account) => ({ account, roi: mock.roiOf(mock.sumSeries(account.daily, range)) }))
      .filter((row) => Number.isFinite(row.roi));
    if (rows.length >= 2) {
      rows.sort((left, right) => right.roi - left.roi);
      const high = rows[0];
      const low = rows[rows.length - 1];
      lines.push(
        `- 方向提示：${high.account.name} 近7天 ROI ${high.roi.toFixed(2)} > ${low.account.name} ROI ${low.roi.toFixed(2)}；把预算从高效率账户挪到低效率账户会稀释整体 ROI。若目标方向与数据相反，先澄清，不要直接提交两笔动作。`,
      );
    }
  }
  if (viewAccount && !seenAccount.has(viewAccount.id)) {
    lines.push(
      `${accountFacts(mock, viewAccount, range)}（当前看板账户，仅用于定位；未在任务中点名时不要擅自改动）`,
    );
  }
  if (blocking.length) {
    lines.push(
      `- 数据缺口：${blocking.map((item) => `${item.account.name}（${item.gaps.join("、")}）`).join("；")} → 本轮只能观察/澄清或先补授权，不能提交投放动作。`,
    );
  } else if (gaps.some((item) => item.gaps.length)) {
    lines.push(
      `- 数据缺口：${gaps.filter((item) => item.gaps.length).map((item) => `${item.account.name}（${item.gaps.join("、")}）`).join("；")} → 不阻断动作，但结论必须标注不确定性。`,
    );
  }
  if (accounts.length) {
    lines.push(
      `- 写动作范围：仅限 ${accounts.map((account) => `${account.name}（${account.id}）`).join("、")}${
        plans.length ? ` 及计划 ${plans.map((plan) => plan.id).join("、")}` : ""
      }；其它账户/计划不可写。`,
    );
  } else if (!explicit) {
    lines.push("- 写动作范围：用户没有点名目标账户/计划；如需动作，先说明依据并在当前看板账户范围内选择，不要跨账户替用户做主。");
  }
  if (plans.length) {
    lines.push(
      "- 工具能力：当前没有「计划级日预算」写工具；计划级只能暂停/恢复/调整出价（±15%）；账户预算用 apply_budget_change（±20%），会影响该账户全部计划。",
    );
  }
  lines.push("- 上下文里的 Top 账户、机会扫描 Top 只是示例，不是授权清单；需要哪个账户的数据就直接查。");
  lines.push("- 若用户口述前提（如余额不足、ROI 很低）与工具数据冲突，必须指出冲突并以工具数据为准，不得迎合前提编造。");

  const percents = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  const requestedPct = percents.length ? Math.max(...percents) : null;
  const overBudgetLimit = requestedPct !== null && /预算/.test(text) && requestedPct > 20;
  const overBidLimit = requestedPct !== null && /出价/.test(text) && requestedPct > 15;
  const overLimit = overBudgetLimit || overBidLimit;
  const bypassRequest = /直接改|直接执行|直接动|不用确认|不用给我确认|马上执行|立刻执行/.test(text);

  return {
    accounts,
    plans,
    viewAccount,
    invalid,
    gaps,
    writeBlocked,
    requestedPct,
    overLimit,
    bypassRequest,
    expectsAction: ACTION_INTENT.test(text) && !OBSERVE_INTENT.test(text) && !overLimit && !bypassRequest,
    scope: { accountIds: scopeAccountIds, planIds: scopePlanIds, invalid: invalid.length > 0 },
    lines: lines.join("\n"),
  };
}

/**
 * 一致性校验：没有成功的写工具记录，就不允许出现“已提交/已执行”这类完成时表述。
 * 只做确定性文本改写，避免用另一个模型来“修饰”事实。
 */
export function sanitizeClaims(text, { submitted = false, executed = false } = {}) {
  let output = String(text ?? "");
  let changed = false;
  const apply = (pattern, replacement) => {
    if (!pattern.test(output)) return;
    output = output.replace(pattern, replacement);
    changed = true;
  };

  if (!submitted) {
    apply(/已提交待确认/g, "未提交");
    apply(/已提交审批/g, "未提交");
    apply(/提交成功/g, "未提交");
    apply(/已提交/g, "未提交");
    apply(/已执行/g, "未执行");
    apply(/已生效/g, "未生效");
    apply(/已创建/g, "未创建");
  } else if (!executed) {
    apply(/已执行/g, "待优化师确认");
    apply(/已生效/g, "待优化师确认");
  }

  return { text: output, changed };
}

/**
 * 方向一致性：同一句里「降低 X%（A→B）」但 B>A（或反过来）属于自相矛盾。
 * 不改数字，只把方向词降级为中性「调整」，避免把错误方向写成结论。
 */
export function neutralizeDirectionConflicts(text) {
  let changed = false;
  const output = String(text ?? "")
    .split(/(?<=[。；\n])/)
    .map((sentence) => {
      const match = sentence.match(
        /(降低|下调|削减|提高|上调|增加)[^0-9]{0,6}(\d+(?:\.\d+)?)\s*%[^0-9]{0,12}?(\d[\d,]*(?:\.\d+)?)\s*(?:元)?\s*(?:→|->|到|至)\s*(\d[\d,]*(?:\.\d+)?)/,
      );
      if (match) {
        const before = Number(match[3].replace(/,/g, ""));
        const after = Number(match[4].replace(/,/g, ""));
        const down = /降低|下调|削减/.test(match[1]);
        const up = /提高|上调|增加/.test(match[1]);
        if ((down && after > before) || (up && after < before)) {
          changed = true;
          return sentence.replace(match[1], "调整");
        }
      }
      const rise = sentence.match(
        /由\s*(\d[\d,]*(?:\.\d+)?)\s*(升至|升到|提高到|降至|降到|下降到)\s*(\d[\d,]*(?:\.\d+)?)/,
      );
      if (rise) {
        const before = Number(rise[1].replace(/,/g, ""));
        const after = Number(rise[3].replace(/,/g, ""));
        const down = /降至|降到|下降/.test(rise[2]);
        const up = /升至|升到|提高/.test(rise[2]);
        if ((down && after > before) || (up && after < before)) {
          changed = true;
          return sentence.replace(rise[2], "变为");
        }
      }
      return sentence;
    })
    .join("");
  return { text: output, changed };
}

/**
 * 动作数量对账：pending 存在时，不允许写“本轮无待确认动作 / 0 笔”这类相反表述。
 */
export function reconcileActionCount(text, { pending = 0 } = {}) {
  let output = String(text ?? "");
  let changed = false;
  if (pending > 0) {
    const patterns = [
      /本轮无待优化师确认动作/g,
      /本轮无待确认动作/g,
      /本轮没有待确认动作/g,
      /本轮 0 笔待确认/g,
      /没有待优化师确认动作/g,
    ];
    for (const pattern of patterns) {
      if (!pattern.test(output)) continue;
      output = output.replace(pattern, `已有 ${pending} 笔待优化师确认动作`);
      changed = true;
    }
  }
  return { text: output, changed };
}
