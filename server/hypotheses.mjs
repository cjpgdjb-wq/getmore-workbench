/**
 * 策略假设库
 *
 * 这里把「观察 → 假设 → 策略 → 实验 → 判定 → 产品化」做成可查询、可回放、可审计的对象。
 *
 * 重要边界：
 * - 观察来自当前 mock 数据（真实结构、模拟数值）；
 * - 回放来自 server/trials.mjs 的确定性模拟实验，不是真实投放实验；
 * - 因此所有回放证据都标记 synthetic=true，置信度最高只到「中」。
 *
 * 产品价值不在“证明某个策略一定有效”，而在：
 * 1. 让假设可被证伪，而不是拍脑袋；
 * 2. 让 Agent 的策略有来源、有对照、有决策规则；
 * 3. 让“评测”从拍脑袋的 case 变成从假设长出来的 case。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "./mock.mjs";
import { buildTrials } from "./trials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "hypotheses.json");

function readCollection(file, key) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Definitions                                                        */
/* ------------------------------------------------------------------ */

const DEFINITIONS = [
  {
    id: "H1",
    shortTitle: "学习期分层干预",
    title: "学习期计划：分层干预，而不是一刀切暂停",
    question: "学习期计划 ROI 低于目标时，暂停、降预算，还是继续观察？",
    tags: ["投放策略", "学习期", "预算"],
    impact: "高",
    baseConfidence: "medium",
    statement:
      "在学习期（3–14 天）竞价计划中，按「ROI 水平 + ROI 趋势 + 转化量 + 消耗规模」分层干预，相对于统一暂停低 ROI 计划，7 天后干预组 ROI 高 ≥0.2，GMV 不低于 -5%，低效消耗占比下降 ≥3pp。",
    mechanism:
      "暂停会打断模型探索，重启后需要重新积累；降预算能保留探索、同时收缩低效消耗。学习期计划内部异质性很大：高效计划往往欠投，低效计划可能只是转化样本不足。",
    population: "学习期 3–14 天的竞价计划，近 7 天消耗 ≥5,000 元",
    intervention: "按 ROI 趋势、转化量、消耗规模分层：低效降预算 10%，高效加预算 5%，其余观察",
    control: "统一暂停 ROI 低于 3.0 的学习期计划",
    primaryMetric: "7 天支付 ROI（DiD，相对统一暂停）",
    guardrail: "GMV 不低于 -5%；库存 ≥7 天；余额 ≥3 天；数据完整",
    horizon: "T+7",
    decisionRule:
      "ROI 提升 ≥0.2 且 p<0.05、GMV 不低于 -5% → 采纳；方向为正但未显著 → 扩样本；护栏破 → 回滚",
    strategy: [
      { group: "A 止损", condition: "ROI <3.0 且趋势向下/持平，转化 ≥20/天，7 天消耗 ≥5,000", action: "预算 -10%，观察 3 天", guardrail: "不直接暂停；3 天后仍低于 2.5 再升级" },
      { group: "B 放量", condition: "ROI ≥3.5 且趋势向上，库存 ≥7 天，余额 ≥3 天", action: "预算 +5%，单次 ≤10%", guardrail: "库存 <7 天不加；品牌计划不适用" },
      { group: "C 观察", condition: "其他（转化 <20/天、数据延迟、部分授权）", action: "不动作，补数据/等窗口", guardrail: "24 小时内复查" },
    ],
    test: {
      method: "配对历史回放 + 2 周影子模式；样本足够再做账户级分层实验",
      unit: "计划",
      sample: "18 对学习期计划（treatment / control 各 18 条计划-周期）",
      window: "前 7 天 vs 后 7 天；T+7 读结果",
      preRegistration: "主指标 ROI；护栏 GMV、库存、余额；不中途改阈值",
      risks: ["选择偏差：只挑‘看起来能救’的计划", "回归均值：低 ROI 计划本来会反弹", "竞价干扰：预算变化影响竞争环境", "模拟数据不能证明真实因果"],
    },
    productization: {
      tool: "get_learning_state（学习期天数、趋势、转化量、消耗规模）",
      skill: "learning_phase_policy（分层规则 + 护栏 + 置信度）",
      evalCases: [
        { id: "H1-case-01", goal: "学习期 ROI 2.8，转化 30/天，消耗 8,000/7d，库存 12 天", expected: "识别学习期；建议降预算 10%，不直接暂停；给 3 天观察窗口" },
        { id: "H1-case-02", goal: "学习期 ROI 4.2，趋势向上，库存 5 天", expected: "识别高效但库存不足；建议观察/补货，不加预算" },
        { id: "H1-case-03", goal: "学习期转化 8/天，数据延迟 18 分钟", expected: "不动作；先补数据，说明样本不足" },
      ],
    },
  },
  {
    id: "H2",
    shortTitle: "数据延迟门禁",
    title: "数据延迟时，先补数据再提案",
    question: "账户数据延迟 16–21 分钟时，Agent 看到 ROI 下滑就提案暂停，是否在制造误停？",
    tags: ["Agent 评测", "数据健康", "误停"],
    impact: "高",
    baseConfidence: "medium",
    statement:
      "对数据延迟 >15 分钟的竞价账户，要求「连续 2 个完整数据窗口 + 数据完整度 ≥90%」才允许提交暂停提案，相对于当前即时提案，误停率相对下降 ≥30%，漏损增加 ≤2pp。",
    mechanism:
      "日初报表未完整时，晚到的转化还没计入，ROI 会被低估；此时暂停会打断探索，而真实损失可能并不存在。延迟不是‘数据不好看’，而是‘判断对象不完整’。",
    population: "报表延迟 >15 分钟的竞价账户",
    intervention: "连续 2 个完整窗口 + 完整度 ≥90% 才允许暂停提案；延迟账户只建议不自动",
    control: "当前策略：单窗口 + 立即提案",
    primaryMetric: "误停率（被暂停但 3 天内恢复）",
    guardrail: "漏损增加 ≤2pp；提案延迟 ≤30 分钟",
    horizon: "T+3",
    decisionRule:
      "误停率相对下降 ≥30%、p<0.05、漏损 ≤2pp → 采纳；否则迭代门禁阈值",
    strategy: [
      { group: "延迟 >15 分钟", condition: "数据完整度 <90% 或只有 1 个完整窗口", action: "只建议观察，不生成暂停提案", guardrail: "显式写数据缺口与下次复查时间" },
      { group: "延迟 10–15 分钟", condition: "完整度 ≥90% 但延迟存在", action: "可提案，但默认中风险，需确认", guardrail: "附最近 3 天完整窗口对比" },
      { group: "延迟 ≤10 分钟", condition: "数据完整", action: "按现有策略", guardrail: "保持原有护栏" },
    ],
    test: {
      method: "告警级历史回放 + 影子模式；先离线混淆矩阵，再上线",
      unit: "告警（账户-日）",
      sample: "120 条告警（treatment / control 各 60 条）",
      window: "T+3 回看；以 3 天内是否恢复判定误停",
      preRegistration: "主指标误停率；护栏漏损；固定阈值 15 分钟 / 90%",
      risks: ["误停标注依赖 3 天回看，存在滞后", "真实漏损难以精确归因", "延迟账户样本少", "模拟告警不能替代真实数据"],
    },
    productization: {
      tool: "data_completeness_gate（完整度、窗口数、延迟分钟）",
      skill: "delayed_data_policy（延迟分层 + 只读/只建议）",
      evalCases: [
        { id: "H2-case-01", goal: "账户延迟 18 分钟，完整度 62%，ROI 环比 -28%", expected: "不生成暂停提案；说明数据缺口；建议 30 分钟后复查" },
        { id: "H2-case-02", goal: "账户延迟 12 分钟，完整度 94%，ROI 连续 2 个窗口低于底线", expected: "可生成暂停提案，标中风险，附完整窗口对比" },
        { id: "H2-case-03", goal: "账户延迟 5 分钟，数据完整，ROI 骤降", expected: "按现有策略处理，不额外降级" },
      ],
    },
  },
  {
    id: "H3",
    shortTitle: "高风险证据默认展开",
    title: "高风险提案：证据默认展开，而不是默认折叠",
    question: "高风险提案默认折叠证据时，优化师是否更容易没看就批？",
    tags: ["信任设计", "HITL", "审批"],
    impact: "中",
    baseConfidence: "low",
    statement:
      "在高风险提案中，把「证据默认展开 + 反事实对比」作为默认交互，相对于「证据默认折叠 + 直接确认」，真人证据查看率提升 ≥20pp，错误批准率下降 ≥10pp，审批时长增加 ≤15 秒。",
    mechanism:
      "证据‘存在’不等于‘被看见’。默认折叠把查看成本转嫁给用户，高风险动作更需要摩擦；但摩擦不能太大，否则会变成确认疲劳。",
    population: "高风险提案（预算接近上限 / 单计划占账户消耗 >50% / 库存 <7 天）",
    intervention: "证据默认展开 + 反事实对比 + 一键查看原始数据",
    control: "证据默认折叠 + 直接确认",
    primaryMetric: "证据查看率；错误批准率",
    guardrail: "审批时长增加 ≤15 秒；待确认积压不增加",
    horizon: "单次审批 + 2 周累计",
    decisionRule:
      "证据查看率 +≥20pp、p<0.05、错误批准率不升、时长 ≤15s → 采纳；错误批准率不显著 → 扩样本",
    strategy: [
      { group: "高风险", condition: "预算接近上限 / 单计划占比 >50% / 库存 <7 天", action: "证据默认展开；必须勾选核对清单", guardrail: "审批时长监控，>60s 警告" },
      { group: "中风险", condition: "预算 +≤10% / 出价 ±10%", action: "证据折叠；一键展开；支持修改后确认", guardrail: "不强制勾选" },
      { group: "低风险", condition: "恢复计划 / 降预算 ≤5%", action: "日报批量确认；保留回滚", guardrail: "批量动作 ≤10 个/批" },
    ],
    test: {
      method: "种子 badcase 实验室 + Demo 埋点；先不做生产 A/B",
      unit: "提案（高风险）",
      sample: "60 条提案（treatment / control 各 30 条）",
      window: "单次审批 + 2 周累计",
      preRegistration: "主指标证据查看率；次要错误批准率；护栏审批时长",
      risks: ["当前 Decision 数据来自 QA，不是真人", "证据查看不等于理解", "错误批准需要事后标注", "小样本下错误批准率不显著"],
    },
    productization: {
      tool: "DecisionReviewModal（默认展开 + 反事实）",
      skill: "risk_based_approval（高/中/低风险交互）",
      evalCases: [
        { id: "H3-case-01", goal: "高风险提案：预算 +20%，库存 4 天，证据含 ROI 3.1", expected: "证据默认展开；提示库存风险；要求勾选核对清单" },
        { id: "H3-case-02", goal: "中风险提案：预算 +8%，证据完整", expected: "证据折叠但一键展开；可直接确认" },
        { id: "H3-case-03", goal: "高风险提案：数据缺口未授权，Agent 仍建议暂停", expected: "拦截；要求补数据；不允许直接确认" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Small stats helpers                                                */
/* ------------------------------------------------------------------ */

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
}

function sd(values) {
  return Math.sqrt(variance(values));
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-abs * abs);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function twoSidedP(z) {
  return Math.max(0.000001, Math.min(0.999999, 2 * (1 - normalCdf(Math.abs(z)))));
}

function proportionTest(a, nA, b, nB) {
  const pA = nA > 0 ? a / nA : 0;
  const pB = nB > 0 ? b / nB : 0;
  const pooled = nA + nB > 0 ? (a + b) / (nA + nB) : 0;
  const se = Math.sqrt(Math.max(0, pooled * (1 - pooled) * (1 / Math.max(1, nA) + 1 / Math.max(1, nB))));
  const z = se > 0 ? (pA - pB) / se : 0;
  const diff = pA - pB;
  return { pA, pB, diff, z, p: twoSidedP(z), se, ci: [diff - 1.96 * se, diff + 1.96 * se] };
}

function fmtMoney(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function fmtPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtNum(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function fmtP(value) {
  if (value < 0.001) return "<0.001";
  return value.toFixed(3);
}

function seriesTotals(series) {
  const cost = series.reduce((sum, point) => sum + (point.cost ?? 0), 0);
  if (cost <= 0) return null;
  const revenue = series.reduce((sum, point) => sum + (point.revenue ?? 0), 0);
  const orders = series.reduce((sum, point) => sum + (point.orders ?? 0), 0);
  return { cost, revenue, orders, roi: revenue / cost, cpa: orders > 0 ? cost / orders : null };
}

function lastDays(series, days) {
  return series.slice(-days);
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

function observationH1(mock) {
  const plans = mock.CAMPAIGNS.filter(
    (plan) => plan.channel === "auction" && plan.learningPhase === "学习中",
  );
  const rows = plans
    .map((plan) => {
      const current = seriesTotals(lastDays(plan.daily, 7));
      if (!current) return null;
      const first3 = seriesTotals(plan.daily.slice(-7, -4));
      const last3 = seriesTotals(plan.daily.slice(-3));
      const roi = current.roi;
      return {
        plan,
        cost: current.cost,
        revenue: current.revenue,
        orders: current.orders,
        roi,
        conversions: current.orders / 7,
        trend: first3 && last3 ? last3.roi - first3.roi : 0,
        band: roi >= 4 ? "≥4.0" : roi >= 3.5 ? "3.5–4.0" : roi >= 3.0 ? "3.0–3.5" : roi >= 2.5 ? "2.5–3.0" : "<2.5",
      };
    })
    .filter(Boolean);

  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  if (!rows.length) {
    return {
      headline: "当前没有学习期计划，无法形成观察。",
      summary: "等有学习期计划后，再评估「分层干预 vs 一刀切暂停」。",
      metrics: [],
      segments: [],
      caveat: "观察窗口：近 7 天；当前 mock 数据里没有学习期计划。",
    };
  }
  const low = rows.filter((row) => row.roi < 3.0);
  const mid = rows.filter((row) => row.roi >= 3.0 && row.roi < 3.5);
  const high = rows.filter((row) => row.roi >= 3.5);
  const lowCost = low.reduce((sum, row) => sum + row.cost, 0);
  const highCost = high.reduce((sum, row) => sum + row.cost, 0);
  const lowConversions = rows.filter((row) => row.conversions < 20).length;
  const improving = rows.filter((row) => row.trend > 0.05).length;
  const declining = rows.filter((row) => row.trend < -0.05).length;

  const bands = ["<2.5", "2.5–3.0", "3.0–3.5", "3.5–4.0", "≥4.0"];
  const segments = bands.map((band) => {
    const list = rows.filter((row) => row.band === band);
    const cost = list.reduce((sum, row) => sum + row.cost, 0);
    const revenue = list.reduce((sum, row) => sum + row.revenue, 0);
    return {
      label: band,
      count: list.length,
      cost,
      roi: cost > 0 ? revenue / cost : 0,
      conversions: list.reduce((sum, row) => sum + row.conversions, 0),
      note: `${list.filter((row) => row.trend > 0.05).length} 个趋势向上`,
    };
  });

  const roiValues = rows.map((row) => row.roi);
  return {
    headline: `学习期计划 ${rows.length} 个，7 天消耗 ${fmtMoney(totalCost)}，ROI ${fmtNum(Math.min(...roiValues))}–${fmtNum(Math.max(...roiValues))}；${rows.filter((row) => row.roi >= 3.0).length} 个 ≥3.0，${low.length} 个 <3.0。`,
    summary: `低效组（ROI <3.0）占 ${fmtPct(lowCost / Math.max(1, totalCost))} 消耗，高效组（≥3.5）占 ${fmtPct(highCost / Math.max(1, totalCost))}；${improving} 个趋势向上，${declining} 个向下。一刀切暂停会误伤高效计划，也会放过低效消耗。`,
    metrics: [
      { label: "学习期计划", value: `${rows.length}`, hint: "近 7 天有消耗" },
      { label: "7 天消耗", value: fmtMoney(totalCost), hint: `支付 ${fmtMoney(totalRevenue)}` },
      { label: "ROI 区间", value: `${fmtNum(Math.min(...roiValues))}–${fmtNum(Math.max(...roiValues))}`, hint: "支付 ROI" },
      { label: "ROI ≥3.0", value: `${rows.filter((row) => row.roi >= 3.0).length}/${rows.length}`, hint: `${mid.length} 个 3.0–3.5` },
      { label: "低效消耗", value: `${fmtMoney(lowCost)}`, hint: `占 ${fmtPct(lowCost / Math.max(1, totalCost))}` },
      { label: "转化不足", value: `${lowConversions}`, hint: "转化 <20/天" },
    ],
    segmentLabel: "转化/天",
    segments,
    caveat: "观察窗口：近 7 天；ROI 为支付 ROI，未扣退款与商品成本。",
  };
}

function observationH2(mock) {
  const auction = mock.ACCOUNTS.filter((account) => account.channel === "auction");
  const delayed = auction.filter((account) => account.dataLagMinutes > 15);
  const normal = auction.filter((account) => account.dataLagMinutes <= 15);
  const allDelayed = mock.ACCOUNTS.filter((account) => account.dataLagMinutes > 15);
  const maxLag = mock.ACCOUNTS.length
    ? Math.max(...mock.ACCOUNTS.map((account) => account.dataLagMinutes))
    : 0;
  const partialAuction = auction.filter((account) => account.authorization !== "已授权").length;
  const partialBrand = mock.ACCOUNTS.filter(
    (account) => account.channel === "brand" && account.authorization !== "已授权",
  ).length;
  const missingNet = auction.filter((account) => !account.dataSources.includes("商品交易")).length;

  function signalStats(accounts) {
    let signals = 0;
    let days = 0;
    for (const account of accounts) {
      const series = account.daily.slice(-14);
      for (let index = 3; index < series.length; index += 1) {
        const current = series[index];
        if (!current || current.cost <= 0) continue;
        const previous = series.slice(index - 3, index).filter((point) => point.cost > 0);
        if (!previous.length) continue;
        const previousRoi =
          previous.reduce((sum, point) => sum + point.revenue, 0) /
          previous.reduce((sum, point) => sum + point.cost, 0);
        const currentRoi = current.revenue / current.cost;
        if (currentRoi < previousRoi * 0.8) signals += 1;
        days += 1;
      }
    }
    return { signals, days, rate: days > 0 ? signals / days : 0 };
  }

  const delayedSignals = signalStats(delayed);
  const normalSignals = signalStats(normal);

  const bucket = (min, max) => {
    const list = delayed.filter(
      (account) => account.dataLagMinutes >= min && account.dataLagMinutes <= max,
    );
    const stats = signalStats(list);
    const cost = list.reduce(
      (sum, account) => sum + lastDays(account.daily, 7).reduce((s, p) => s + p.cost, 0),
      0,
    );
    const revenue = list.reduce(
      (sum, account) => sum + lastDays(account.daily, 7).reduce((s, p) => s + p.revenue, 0),
      0,
    );
    return {
      label: `${min}–${max} 分钟`,
      count: list.length,
      cost,
      roi: cost > 0 ? revenue / cost : 0,
      conversions: stats.signals,
      note: `${stats.signals}/${stats.days} 个账户日疑似下滑`,
    };
  };

  const segments = [bucket(16, 18), bucket(19, 21)].filter((row) => row.count > 0);
  return {
    headline: `${allDelayed.length} 个账户延迟 16–21 分钟（竞价 ${delayed.length} 个），最大 ${maxLag} 分钟；${partialAuction} 个竞价账户部分授权，${missingNet} 个缺净成交。`,
    summary: `近 14 天延迟账户出现 ${delayedSignals.signals} 次单日 ROI 跌幅 >20% 的疑似信号（${delayedSignals.signals}/${delayedSignals.days}，${fmtPct(delayedSignals.rate)}），非延迟账户 ${normalSignals.signals}/${normalSignals.days}（${fmtPct(normalSignals.rate)}）。差异不大，不能证明延迟导致误停；但数据缺口会让 Agent 把“没拿到”当成“下滑”，所以值得做告警级回放。`,
    metrics: [
      { label: "延迟账户", value: `${allDelayed.length}`, hint: `竞价 ${delayed.length}` },
      { label: "最大延迟", value: `${maxLag} 分钟`, hint: "报表同步" },
      { label: "部分授权", value: `${partialAuction} 竞价`, hint: `品牌 ${partialBrand}` },
      { label: "缺净成交", value: `${missingNet}`, hint: "竞价账户" },
      { label: "疑似下滑", value: `${delayedSignals.signals} 次`, hint: "近 14 天" },
      { label: "信号率", value: fmtPct(delayedSignals.rate), hint: `非延迟 ${fmtPct(normalSignals.rate)}` },
    ],
    segmentLabel: "疑似信号",
    segments,
    caveat: "信号定义：单日 ROI < 前 3 日均值 ×0.8；只说明波动，不等于误停。",
  };
}

function observationH3() {
  const decisions = readCollection("decisions.json", "decisions");
  const operations = readCollection("operations.json", "operations");
  const highRisk = decisions.filter((decision) => decision.riskLevel === "high");
  const approved = decisions.filter((decision) => decision.status === "approved" && decision.decidedAt);
  const approvalSeconds = approved
    .map((decision) => (decision.decidedAt - decision.createdAt) / 1000)
    .sort((a, b) => a - b);
  const median =
    approvalSeconds.length > 0
      ? approvalSeconds[Math.floor(approvalSeconds.length / 2)]
      : null;
  const undone = operations.filter((operation) => operation.undone).length;
  const qaCount = decisions.filter((decision) => /smoke|regression|HITL/i.test(decision.comment ?? "")).length;
  const statusCounts = ["approved", "rejected", "expired", "pending"].map((status) => ({
    label:
      status === "approved" ? "通过" : status === "rejected" ? "拒绝" : status === "expired" ? "过期" : "待确认",
    count: decisions.filter((decision) => decision.status === status).length,
    cost: 0,
    roi: 0,
    conversions: 0,
    note: decisions.length ? fmtPct(decisions.filter((decision) => decision.status === status).length / decisions.length) : "0%",
  }));

  const medianLabel =
    median === null ? "--" : median < 1 ? `${Math.round(median * 1000)}ms` : `${median.toFixed(1)}s`;
  const statusText = statusCounts.map((item) => `${item.label} ${item.count}`).join(" / ");

  if (!decisions.length) {
    return {
      headline: "还没有 Decision 数据，无法观察审批行为。",
      summary: "先执行一次伙伴任务或商品工作区提案，再回来评估审批交互。",
      metrics: [
        { label: "Decision", value: "0", hint: "暂无" },
        { label: "审批中位", value: "--", hint: "暂无" },
        { label: "已撤销", value: "0/0", hint: "暂无" },
        { label: "数据来源", value: "未识别", hint: "需要埋点" },
      ],
      segments: [],
      caveat: "当前 .runtime/partner/decisions.json 为空。",
    };
  }

  return {
    headline: `${decisions.length} 个 Decision（${statusText}），${highRisk.length} 个高风险；审批中位耗时 ${medianLabel}，${operations.length} 个操作中 ${undone} 个被撤销。`,
    summary:
      qaCount > 0
        ? `审批中位耗时 ${medianLabel} 看起来像“橡皮图章”，但 ${qaCount} 条备注含 smoke/regression，说明样本来自 QA 脚本，不是真人。先补真人埋点，再谈审批疲劳；否则这个假设不成立。`
        : `审批中位耗时 ${medianLabel}；需要埋点区分“看了证据”和“直接确认”，再判断是否存在橡皮图章。`,
    metrics: [
      { label: "Decision", value: `${decisions.length}`, hint: `高风险 ${highRisk.length}` },
      { label: "审批中位", value: medianLabel, hint: approved.length ? `${approved.length} 个已通过` : "暂无" },
      { label: "已撤销", value: `${undone}/${operations.length}`, hint: "含已回滚" },
      { label: "数据来源", value: qaCount > 0 ? "QA 脚本" : "未识别", hint: qaCount > 0 ? "不能当真人行为" : "需要埋点" },
      { label: "高风险占比", value: decisions.length ? fmtPct(highRisk.length / decisions.length) : "--", hint: "风险分级" },
    ],
    segments: [],
    caveat:
      qaCount > 0
        ? `当前 Decision 的 ${qaCount} 条备注含 smoke/regression，样本来自本地 QA；不能作为真人审批行为的证据。`
        : "当前 Decision 数据未标注是否真人；需要补充 evidence_viewed / review_started_at 埋点。",
  };
}

function buildObservation(id, mock) {
  if (id === "H1") return observationH1(mock);
  if (id === "H2") return observationH2(mock);
  return observationH3();
}

/* ------------------------------------------------------------------ */
/* Evidence                                                           */
/* ------------------------------------------------------------------ */

const VERDICT_LABEL = {
  validated: "已验证",
  inconclusive: "方向正确，样本不足",
  rejected: "未通过",
  draft: "待回放",
};

function evidenceH1(trials) {
  const treatment = trials.filter((trial) => trial.arm === "treatment");
  const control = trials.filter((trial) => trial.arm === "control");
  const byPair = new Map();
  for (const trial of trials) {
    const pair = byPair.get(trial.pairingKey) ?? {};
    pair[trial.arm] = trial;
    byPair.set(trial.pairingKey, pair);
  }
  const pairs = [...byPair.values()].filter((pair) => pair.treatment && pair.control);
  const diffs = pairs.map((pair) => {
    return (
      pair.treatment.post.roi -
      pair.treatment.pre.roi -
      (pair.control.post.roi - pair.control.pre.roi)
    );
  });
  const effect = mean(diffs);
  const se = diffs.length > 1 ? sd(diffs) / Math.sqrt(diffs.length) : 0;
  const z = se > 0 ? effect / se : 0;
  const p = twoSidedP(z);
  const ci = [effect - 1.96 * se, effect + 1.96 * se];
  const preRevenueT = treatment.reduce((sum, trial) => sum + trial.pre.revenue, 0);
  const postRevenueT = treatment.reduce((sum, trial) => sum + trial.post.revenue, 0);
  const preRevenueC = control.reduce((sum, trial) => sum + trial.pre.revenue, 0);
  const postRevenueC = control.reduce((sum, trial) => sum + trial.post.revenue, 0);
  const gmvT = postRevenueT / Math.max(1, preRevenueT) - 1;
  const gmvC = postRevenueC / Math.max(1, preRevenueC) - 1;
  const roiT = mean(treatment.map((trial) => trial.post.roi));
  const roiC = mean(control.map((trial) => trial.post.roi));
  const guardrailPass = gmvT >= -0.05;
  const verdict =
    effect >= 0.2 && p < 0.05 && guardrailPass
      ? "validated"
      : effect > 0 && guardrailPass
        ? "inconclusive"
        : "rejected";
  const confidence = p < 0.05 && pairs.length >= 15 ? "medium" : "low";

  return {
    synthetic: true,
    ranAt: Date.now(),
    sample: { treatment: treatment.length, control: control.length, unit: "plan", pairs: pairs.length },
    metrics: [
      {
        key: "roi",
        label: "7 天 ROI",
        treatment: roiT,
        control: roiC,
        effect,
        unit: "",
        effectUnit: "",
        better: "higher",
        p,
        ci,
      },
      {
        key: "gmv",
        label: "GMV 变化",
        treatment: gmvT * 100,
        control: gmvC * 100,
        effect: (gmvT - gmvC) * 100,
        unit: "%",
        effectUnit: "pp",
        better: "higher",
        p: null,
      },
    ],
    guardrails: [
      {
        label: "GMV 不低于 -5%",
        value: gmvT * 100,
        treatment: gmvT * 100,
        control: gmvC * 100,
        threshold: -5,
        unit: "%",
        pass: guardrailPass,
      },
    ],
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    confidence,
    summary: `分层干预组 7 天 ROI ${fmtNum(roiT)}，暂停组 ${fmtNum(roiC)}；DiD ${effect >= 0 ? "+" : ""}${fmtNum(effect)}（95% CI ${fmtNum(ci[0])}–${fmtNum(ci[1])}，p=${fmtP(p)}）。干预组 GMV ${fmtPct(gmvT)}，${guardrailPass ? "未破" : "已破"} -5% 护栏。`,
    caveat: "模拟配对回放：前 7 天来自 mock，后 7 天为确定性模拟；不代表真实因果，只验证方法与链路。",
  };
}

function evidenceH2(trials) {
  const treatment = trials.filter((trial) => trial.arm === "treatment");
  const control = trials.filter((trial) => trial.arm === "control");
  const falsePauseT = treatment.reduce((sum, trial) => sum + trial.outcome.falsePause, 0);
  const falsePauseC = control.reduce((sum, trial) => sum + trial.outcome.falsePause, 0);
  const prop = proportionTest(falsePauseT, treatment.length, falsePauseC, control.length);
  const missedT = mean(treatment.map((trial) => trial.outcome.missedLossPct));
  const missedC = mean(control.map((trial) => trial.outcome.missedLossPct));
  const missedDiff = missedT - missedC;
  const guardrailPass = missedDiff <= 0.02;
  const relative = prop.pB > 0 ? (prop.pB - prop.pA) / prop.pB : 0;
  const verdict =
    relative >= 0.3 && prop.p < 0.05 && guardrailPass
      ? "validated"
      : relative > 0 && guardrailPass
        ? "inconclusive"
        : "rejected";
  const confidence = prop.p < 0.05 ? "medium" : "low";

  return {
    synthetic: true,
    ranAt: Date.now(),
    sample: { treatment: treatment.length, control: control.length, unit: "alert" },
    metrics: [
      {
        key: "falsePause",
        label: "误停率",
        treatment: prop.pA * 100,
        control: prop.pB * 100,
        effect: (prop.pA - prop.pB) * 100,
        unit: "%",
        effectUnit: "pp",
        better: "lower",
        p: prop.p,
        ci: [prop.ci[0] * 100, prop.ci[1] * 100],
      },
      {
        key: "missedLoss",
        label: "漏损",
        treatment: missedT * 100,
        control: missedC * 100,
        effect: missedDiff * 100,
        unit: "%",
        effectUnit: "pp",
        better: "lower",
        p: null,
      },
    ],
    guardrails: [
      {
        label: "漏损增加 ≤2pp",
        value: missedDiff * 100,
        treatment: missedT * 100,
        control: missedC * 100,
        threshold: 2,
        unit: "pp",
        pass: guardrailPass,
      },
    ],
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    confidence,
    summary: `门禁组误停率 ${fmtPct(prop.pA)}，对照组 ${fmtPct(prop.pB)}；相对下降 ${fmtPct(Math.max(0, relative))}（p=${fmtP(prop.p)}）。漏损 ${fmtPct(missedT)} vs ${fmtPct(missedC)}，增加 ${fmtNum(missedDiff * 100)}pp，${guardrailPass ? "未破" : "已破"} +2pp 护栏。`,
    caveat: "模拟告警回放：账户来自真实 mock，误停/漏损为确定性模拟；不代表真实因果。",
  };
}

function evidenceH3(trials) {
  const treatment = trials.filter((trial) => trial.arm === "treatment");
  const control = trials.filter((trial) => trial.arm === "control");
  const evidenceT = treatment.reduce((sum, trial) => sum + trial.outcome.evidenceViewed, 0);
  const evidenceC = control.reduce((sum, trial) => sum + trial.outcome.evidenceViewed, 0);
  const evidenceTest = proportionTest(evidenceT, treatment.length, evidenceC, control.length);
  const wrongT = treatment.reduce((sum, trial) => sum + trial.outcome.wrongApproval, 0);
  const wrongC = control.reduce((sum, trial) => sum + trial.outcome.wrongApproval, 0);
  const wrongTest = proportionTest(wrongT, treatment.length, wrongC, control.length);
  const timeT = mean(treatment.map((trial) => trial.outcome.approvalSeconds));
  const timeC = mean(control.map((trial) => trial.outcome.approvalSeconds));
  const timeDiff = timeT - timeC;
  const guardrailPass = timeDiff <= 15;
  const evidenceLift = evidenceTest.pA - evidenceTest.pB;
  const wrongLift = wrongTest.pA - wrongTest.pB;
  let verdict;
  if (evidenceLift >= 0.2 && evidenceTest.p < 0.05 && guardrailPass && wrongLift <= 0) {
    verdict = wrongTest.p < 0.05 ? "validated" : "inconclusive";
  } else if (evidenceLift > 0 && guardrailPass) {
    verdict = "inconclusive";
  } else {
    verdict = "rejected";
  }
  const confidence = verdict === "validated" ? "medium" : "low";

  return {
    synthetic: true,
    ranAt: Date.now(),
    sample: { treatment: treatment.length, control: control.length, unit: "decision" },
    metrics: [
      {
        key: "evidenceViewed",
        label: "证据查看率",
        treatment: evidenceTest.pA * 100,
        control: evidenceTest.pB * 100,
        effect: evidenceLift * 100,
        unit: "%",
        effectUnit: "pp",
        better: "higher",
        p: evidenceTest.p,
        ci: [evidenceTest.ci[0] * 100, evidenceTest.ci[1] * 100],
      },
      {
        key: "wrongApproval",
        label: "错误批准率",
        treatment: wrongTest.pA * 100,
        control: wrongTest.pB * 100,
        effect: wrongLift * 100,
        unit: "%",
        effectUnit: "pp",
        better: "lower",
        p: wrongTest.p,
        ci: [wrongTest.ci[0] * 100, wrongTest.ci[1] * 100],
      },
      {
        key: "approvalSeconds",
        label: "审批时长",
        treatment: timeT,
        control: timeC,
        effect: timeDiff,
        unit: "s",
        effectUnit: "s",
        better: "lower",
        p: null,
      },
    ],
    guardrails: [
      {
        label: "审批时长增加 ≤15s",
        value: timeDiff,
        treatment: timeT,
        control: timeC,
        threshold: 15,
        unit: "s",
        pass: guardrailPass,
      },
    ],
    verdict,
    verdictLabel: VERDICT_LABEL[verdict],
    confidence,
    summary:
      verdict === "inconclusive"
        ? `证据查看率 ${fmtPct(evidenceTest.pA)} vs ${fmtPct(evidenceTest.pB)}（${evidenceLift >= 0 ? "+" : ""}${fmtNum(evidenceLift * 100)}pp，p=${fmtP(evidenceTest.p)}）；错误批准率 ${fmtPct(wrongTest.pA)} vs ${fmtPct(wrongTest.pB)}（${fmtNum(wrongLift * 100)}pp，p=${fmtP(wrongTest.p)}，不显著）；审批时长 +${fmtNum(timeDiff)}s。方向正确，但错误批准率样本不足，先扩到 120/组。`
        : `证据查看率 ${fmtPct(evidenceTest.pA)} vs ${fmtPct(evidenceTest.pB)}；错误批准率 ${fmtPct(wrongTest.pA)} vs ${fmtPct(wrongTest.pB)}；审批时长 +${fmtNum(timeDiff)}s，${guardrailPass ? "未破" : "已破"} 15s 护栏。`,
    caveat: "模拟提案回放：提案来自真实计划清单，查看/错误批准为确定性模拟；当前真实审批数据来自 QA，不能替代真人埋点。",
  };
}

function computeEvidence(id, trials) {
  if (id === "H1") return evidenceH1(trials);
  if (id === "H2") return evidenceH2(trials);
  return evidenceH3(trials);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

function readResults() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (parsed && typeof parsed.results === "object") return parsed.results;
  } catch {
    /* first run */
  }
  return {};
}

function writeResults(results) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ results }, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

/* ------------------------------------------------------------------ */
/* Cards                                                              */
/* ------------------------------------------------------------------ */

function definitionById(id) {
  return DEFINITIONS.find((item) => item.id === id) ?? null;
}

function statusTone(status) {
  if (status === "validated") return "green";
  if (status === "inconclusive") return "orange";
  if (status === "rejected") return "red";
  return "gray";
}

function buildCard(definition, observation, trials, evidence) {
  const status = evidence?.verdict ?? "draft";
  return {
    ...definition,
    observation,
    hypothesis: {
      statement: definition.statement,
      mechanism: definition.mechanism,
      population: definition.population,
      intervention: definition.intervention,
      control: definition.control,
      primaryMetric: definition.primaryMetric,
      guardrail: definition.guardrail,
      horizon: definition.horizon,
      decisionRule: definition.decisionRule,
    },
    status,
    statusLabel: VERDICT_LABEL[status] ?? status,
    statusTone: statusTone(status),
    confidence: evidence?.confidence ?? definition.baseConfidence,
    confidenceLabel:
      (evidence?.confidence ?? definition.baseConfidence) === "high"
        ? "高"
        : (evidence?.confidence ?? definition.baseConfidence) === "medium"
          ? "中"
          : "低",
    trialCount: trials.length,
    evidence: evidence ?? null,
    updatedAt: evidence?.ranAt ?? null,
  };
}

function summaryOf(cards) {
  const count = (status) => cards.filter((card) => card.status === status).length;
  return {
    total: cards.length,
    validated: count("validated"),
    inconclusive: count("inconclusive"),
    rejected: count("rejected"),
    draft: count("draft"),
    trials: cards.reduce((sum, card) => sum + card.trialCount, 0),
    synthetic: true,
  };
}

const CAVEAT =
  "回放使用确定性模拟实验数据，只验证「观察→假设→对照→效应→决策」的方法与产品链路，不代表真实因果。";

export async function getHypothesisLibrary() {
  const mock = await loadMock();
  const trials = buildTrials(mock);
  const results = readResults();
  const cards = DEFINITIONS.map((definition) =>
    buildCard(
      definition,
      buildObservation(definition.id, mock),
      trials[definition.id] ?? [],
      results[definition.id] ?? null,
    ),
  );
  return {
    hypotheses: cards,
    summary: summaryOf(cards),
    generatedAt: Date.now(),
    caveat: CAVEAT,
  };
}

export async function replayHypothesis(id) {
  const definition = definitionById(id);
  if (!definition) return { ok: false, error: "假设不存在" };
  const mock = await loadMock();
  const trials = buildTrials(mock);
  const list = trials[id] ?? [];
  if (!list.length) return { ok: false, error: "没有可回放的数据" };
  const evidence = computeEvidence(id, list);
  const results = readResults();
  results[id] = evidence;
  writeResults(results);
  const cards = DEFINITIONS.map((item) =>
    buildCard(
      item,
      buildObservation(item.id, mock),
      trials[item.id] ?? [],
      results[item.id] ?? null,
    ),
  );
  const card = cards.find((item) => item.id === id) ?? null;
  return { ok: true, hypothesis: card, summary: summaryOf(cards) };
}

export function hypothesisDefinitions() {
  return DEFINITIONS.map((definition) => ({
    id: definition.id,
    title: definition.title,
    shortTitle: definition.shortTitle,
    tags: definition.tags,
  }));
}
