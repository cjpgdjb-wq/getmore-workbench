/**
 * 假设回放数据（演示用）
 *
 * 这不是真实投放实验，也不是从生产数据里捞出来的因果证据。
 * 它的用途只有一个：让「观察 → 假设 → 对照 → 效应 → 决策规则」这条链路在 Demo 里真实跑通，
 * 并且能被复现、能被审计。
 *
 * 生成方式：
 * - H1：用学习期计划真实的「前 7 天」作为基线，配对生成 treatment / control 两个反事实后 7 天；
 * - H2：用真实的延迟账户清单，按固定比例生成「是否误停 / 漏损」的告警级结果；
 * - H3：用真实的高消耗计划清单，按固定比例生成「是否看证据 / 是否错误批准」的提案级结果。
 *
 * 所有随机都来自确定性 seed，同一份 mock 数据每次生成的结果一致。
 */

const H1_EFFECT_ROI = 0.22;
const H1_CONTROL_ROI = -0.05;

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(key, index = 0) {
  return mulberry32(hash(`${key}#${index}`))();
}

function randRange(key, index, min, max) {
  return min + rand(key, index) * (max - min);
}

/** 确定性洗牌，用于把固定数量的“命中”分散到不同 unit 上。 */
function shuffle(list, key) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand(key, i) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function totals(series) {
  const cost = series.reduce((sum, point) => sum + (point.cost ?? 0), 0);
  if (cost <= 0) return null;
  const revenue = series.reduce((sum, point) => sum + (point.revenue ?? 0), 0);
  const orders = series.reduce((sum, point) => sum + (point.orders ?? 0), 0);
  return {
    cost,
    revenue,
    orders,
    roi: revenue / cost,
    cpa: orders > 0 ? cost / orders : null,
    days: series.length,
  };
}

function seriesWindow(series, start, end) {
  return series.slice(start, end);
}

/**
 * H1：学习期分层干预
 *
 * 每个学习期计划生成一对反事实：
 * - treatment：降预算 10%（保留探索）→ 后 7 天 ROI +0.22
 * - control：直接暂停 → 后 7 天 ROI -0.05，且消耗收缩更多
 *
 * 为什么用配对：同一个计划的两个反事实，能消掉类目、素材、账户基础差异；
 * 真实实验仍需要随机分组，这里只验证方法。
 */
function buildH1Trials(mock) {
  const plans = mock.CAMPAIGNS.filter(
    (plan) => plan.channel === "auction" && plan.learningPhase === "学习中",
  );
  const trials = [];

  for (const plan of plans) {
    const pre = totals(seriesWindow(plan.daily, -14, -7)) ?? totals(seriesWindow(plan.daily, -7));
    if (!pre || pre.cost <= 0) continue;
    const seed = `h1-${plan.id}`;
    const preRoi = pre.revenue / pre.cost;
    const aov = pre.orders > 0 ? pre.revenue / pre.orders : 200;

    // treatment：保留探索，降预算；ROI 有小幅正向
    const treatCost = pre.cost * (0.94 + (rand(seed, 1) - 0.5) * 0.04);
    const treatRoi = Math.max(0.8, preRoi + H1_EFFECT_ROI + (rand(seed, 2) - 0.5) * 0.06);
    const treatRevenue = treatCost * treatRoi;
    const treatOrders = Math.max(1, Math.round(treatRevenue / aov));

    // control：暂停；消耗收缩更多，ROI 小幅负向
    const controlCost = pre.cost * (0.88 + (rand(seed, 3) - 0.5) * 0.04);
    const controlRoi = Math.max(0.8, preRoi + H1_CONTROL_ROI + (rand(seed, 4) - 0.5) * 0.06);
    const controlRevenue = controlCost * controlRoi;
    const controlOrders = Math.max(1, Math.round(controlRevenue / aov));

    const meta = {
      roiBand: preRoi >= 3.5 ? "高效" : preRoi >= 3.0 ? "中效" : "低效",
      learningDays: plan.learningDays ?? 0,
      conversionsPerDay: pre.orders / 7,
      spendPerDay: pre.cost / 7,
      mode: plan.mode,
      target: plan.target,
    };

    for (const arm of ["treatment", "control"]) {
      const isTreatment = arm === "treatment";
      const postCost = isTreatment ? treatCost : controlCost;
      const postRevenue = isTreatment ? treatRevenue : controlRevenue;
      const postOrders = isTreatment ? treatOrders : controlOrders;
      trials.push({
        id: `h1-${plan.id}-${isTreatment ? "t" : "c"}`,
        hypothesisId: "H1",
        arm,
        unit: "plan",
        unitId: plan.id,
        unitName: plan.name,
        pairingKey: plan.id,
        pre,
        post: {
          cost: postCost,
          revenue: postRevenue,
          orders: postOrders,
          roi: postRevenue / postCost,
          cpa: postCost / postOrders,
          days: 7,
        },
        outcome: {},
        meta,
      });
    }
  }

  return trials;
}

/**
 * H2：数据延迟门禁
 *
 * 告警级 trial：每条告警要么走「立即提案」，要么走「连续 2 个完整窗口 + 完整度 ≥90%」。
 * 结果：
 * - 误停（被暂停但 3 天内恢复）：treatment 8.3%，control 23.3%
 * - 漏损（该停没停造成的额外损失）：treatment 3.2%，control 2.1%
 *
 * 固定数量 + 确定性洗牌，保证结果可复现；比纯随机更适合 Demo 与回归。
 */
function buildH2Trials(mock) {
  const delayed = mock.ACCOUNTS.filter(
    (account) => account.channel === "auction" && account.dataLagMinutes > 15,
  );
  if (!delayed.length) return [];

  const perArm = 60;
  const indices = Array.from({ length: perArm * 2 }, (_, index) => index);
  const treatmentIndices = shuffle(indices, "h2-arm").slice(0, perArm);
  const treatmentSlots = new Set(treatmentIndices);
  const controlIndices = indices.filter((index) => !treatmentSlots.has(index));
  const falsePauseTreatmentSlots = new Set(shuffle(treatmentIndices, "h2-fp-t").slice(0, 5)); // 5/60
  const falsePauseControlSlots = new Set(shuffle(controlIndices, "h2-fp-c").slice(0, 14)); // 14/60
  const signalKinds = ["日 ROI 跌幅 >20%", "消耗偏离预算", "转化数骤降"];

  return indices.map((index) => {
    const isTreatment = treatmentSlots.has(index);
    const arm = isTreatment ? "treatment" : "control";
    const account = delayed[index % delayed.length];
    const seed = `h2-${index}`;
    const falsePause = isTreatment
      ? falsePauseTreatmentSlots.has(index)
      : falsePauseControlSlots.has(index);
    const missedLossBase = isTreatment ? 0.032 : 0.021;
    const missedLossPct = Math.max(0, missedLossBase + (rand(seed, 1) - 0.5) * 0.006);
    return {
      id: `h2-alert-${String(index + 1).padStart(3, "0")}`,
      hypothesisId: "H2",
      arm,
      unit: "alert",
      unitId: `alert-${account.id}-${index + 1}`,
      unitName: `${account.name} · ${signalKinds[index % signalKinds.length]}`,
      pairingKey: null,
      pre: null,
      post: null,
      outcome: {
        falsePause: falsePause ? 1 : 0,
        missedLossPct,
      },
      meta: {
        accountId: account.id,
        lagMinutes: account.dataLagMinutes,
        signalKind: signalKinds[index % signalKinds.length],
      },
    };
  });
}

/**
 * H3：高风险提案的证据默认展开
 *
 * 提案级 trial：
 * - treatment：证据默认展开 + 反事实对比
 * - control：证据默认折叠 + 直接确认
 *
 * 结果：
 * - 证据查看率：treatment 73.3%，control 40%
 * - 错误批准率：treatment 6.7%，control 13.3%
 * - 审批时长：treatment 34s，control 22s
 *
 * 错误批准率在 30/arm 下不显著——这是故意的：Demo 要展示“方向正确但样本不足”，
 * 而不是把所有假设都做成“已验证”。
 */
function buildH3Trials(mock) {
  const plans = mock.CAMPAIGNS
    .filter((plan) => plan.channel === "auction" && plan.status === "投放中")
    .slice()
    .sort((a, b) => {
      const costA = totals(seriesWindow(a.daily, -7))?.cost ?? 0;
      const costB = totals(seriesWindow(b.daily, -7))?.cost ?? 0;
      return costB - costA;
    })
    .slice(0, 30);

  if (!plans.length) return [];

  const indices = Array.from({ length: 60 }, (_, index) => index);
  const treatmentIndices = shuffle(indices, "h3-arm").slice(0, 30);
  const treatmentSlots = new Set(treatmentIndices);
  const controlIndices = indices.filter((index) => !treatmentSlots.has(index));
  const evidenceSlots = new Set(shuffle(treatmentIndices, "h3-evidence-t").slice(0, 22)); // 22/30
  const controlEvidenceSlots = new Set(shuffle(controlIndices, "h3-evidence-c").slice(0, 12)); // 12/30
  const wrongSlots = new Set(shuffle(treatmentIndices, "h3-wrong-t").slice(0, 2)); // 2/30
  const controlWrongSlots = new Set(shuffle(controlIndices, "h3-wrong-c").slice(0, 4)); // 4/30

  return indices.map((index) => {
    const isTreatment = treatmentSlots.has(index);
    const arm = isTreatment ? "treatment" : "control";
    const plan = plans[index % plans.length];
    const seed = `h3-${index}`;
    const evidenceViewed = isTreatment ? evidenceSlots.has(index) : controlEvidenceSlots.has(index);
    const wrongApproval = isTreatment ? wrongSlots.has(index) : controlWrongSlots.has(index);
    const approvalBase = isTreatment ? 34 : 22;
    return {
      id: `h3-review-${String(index + 1).padStart(3, "0")}`,
      hypothesisId: "H3",
      arm,
      unit: "decision",
      unitId: `decision-${index + 1}`,
      unitName: plan.name,
      pairingKey: null,
      pre: null,
      post: null,
      outcome: {
        evidenceViewed: evidenceViewed ? 1 : 0,
        wrongApproval: wrongApproval ? 1 : 0,
        approvalSeconds: Math.max(5, approvalBase + (rand(seed, 1) - 0.5) * 10),
      },
      meta: {
        planId: plan.id,
        riskLevel: "high",
        spend7d: totals(seriesWindow(plan.daily, -7))?.cost ?? 0,
      },
    };
  });
}

export function buildTrials(mock) {
  return {
    H1: buildH1Trials(mock),
    H2: buildH2Trials(mock),
    H3: buildH3Trials(mock),
  };
}
