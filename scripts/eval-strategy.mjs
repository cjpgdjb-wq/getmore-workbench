/**
 * 策略实验 · 历史回放评测
 *
 * 做法：
 * - 选若干历史 T0；
 * - 只给推荐引擎 T0 之前的数据；
 * - 用 T+7 的真实 mock 数据做“事后标签”；
 * - 找一个 T0 时相似的计划/账户做对照；
 * - 比较规则建议的动作 vs 事后标签，算准确率、校准、护栏。
 *
 * 注意：这是“事后相对表现”评测，不是严格因果 A/B。
 */

import "./eval-clock.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { getRecommendations } from "../server/experiments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "docs", "eval");
const CASE_FILE = path.join(OUT_DIR, "cases.json");
const REPORT_FILE = path.join(OUT_DIR, "report.md");
const JSON_REPORT = path.join(OUT_DIR, "report.json");

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(key, days) {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function totals(series, start, end) {
  const rows = series.filter((point) => point.date >= start && point.date <= end);
  const cost = rows.reduce((sum, point) => sum + (point.cost ?? 0), 0);
  const revenue = rows.reduce((sum, point) => sum + (point.revenue ?? 0), 0);
  const orders = rows.reduce((sum, point) => sum + (point.orders ?? 0), 0);
  return {
    cost,
    revenue,
    orders,
    roi: cost > 0 ? revenue / cost : 0,
    cpa: orders > 0 ? cost / orders : null,
    days: rows.length,
  };
}

function gmvDelta(pre, post) {
  return pre.revenue > 0 ? post.revenue / pre.revenue - 1 : 0;
}

function actionBucket(recommendation) {
  if (!recommendation.sampleAdequate) return "observe";
  if (recommendation.action.type === "observe") return "observe";
  const delta = Number(recommendation.action.deltaPct ?? 0);
  if (delta > 0) return "increase";
  if (delta < 0) return "reduce";
  return "observe";
}

function goldAction({ pre, post, controlPre, controlPost, conversions }) {
  if (conversions < 20 || pre.cost < 3000) return "observe";
  const targetRoiDelta = post.roi - pre.roi;
  const controlRoiDelta = controlPost.roi - controlPre.roi;
  const did = targetRoiDelta - controlRoiDelta;
  const gmvRelative = gmvDelta(pre, post) - gmvDelta(controlPre, controlPost);
  if (did <= -0.2 || gmvRelative <= -0.08) return "reduce";
  if (did >= 0.2 && gmvRelative >= -0.05) return "increase";
  return "observe";
}

function pickControl(mock, target, kind, asOf) {
  const preStart = addDays(asOf, -6);
  const t7 = addDays(asOf, 7);
  const targetRoi = target.pre.roi;
  const targetCost = target.pre.cost;
  const candidates =
    kind === "plan"
      ? mock.CAMPAIGNS.filter((plan) => plan.id !== target.id && plan.mode === target.mode && plan.target === target.target)
      : mock.ACCOUNTS.filter((account) => account.id !== target.id && account.channel === target.channel);

  let best = null;
  for (const candidate of candidates) {
    const pre = totals(candidate.daily, preStart, asOf);
    const post = totals(candidate.daily, addDays(asOf, 1), t7);
    if (pre.cost <= 0 || post.cost <= 0) continue;
    const sameAccount = kind === "plan" && candidate.accountId === target.accountId ? 0 : 1;
    const score = Math.abs(pre.roi - targetRoi) + Math.abs(pre.cost - targetCost) / Math.max(1, targetCost) * 2 + sameAccount * 0.3;
    if (!best || score < best.score) {
      best = { candidate, pre, post, score };
    }
  }
  return best;
}

function buildCase(mock, recommendation, asOf) {
  const t7 = addDays(asOf, 7);
  const preStart = addDays(asOf, -6);
  const isPlan = recommendation.scope.planIds.length > 0;
  const targetId = isPlan ? recommendation.scope.planIds[0] : recommendation.scope.accountId;
  const target =
    isPlan ? mock.CAMPAIGNS.find((plan) => plan.id === targetId) : mock.ACCOUNTS.find((account) => account.id === targetId);
  if (!target) return null;

  const pre = isPlan
    ? totals(target.daily, preStart, asOf)
    : totals(target.daily, preStart, asOf);
  const post = totals(target.daily, addDays(asOf, 1), t7);
  if (pre.cost <= 0 || post.cost <= 0) return null;

  const control = pickControl(mock, { id: target.id, mode: target.mode, target: target.target, accountId: target.accountId, channel: target.channel, pre }, isPlan ? "plan" : "account", asOf);
  if (!control) return null;

  const conversions = pre.orders / 7;
  const gold = goldAction({ pre, post, controlPre: control.pre, controlPost: control.post, conversions });
  const effective = actionBucket(recommendation);
  const predicted = typeof recommendation.expected?.value === "number" ? recommendation.expected.value : null;
  const gmvTarget = gmvDelta(pre, post);
  const gmvControl = gmvDelta(control.pre, control.post);
  const gmvRelative = gmvTarget - gmvControl;
  const guardrail = effective === "observe" ? null : gmvRelative >= -0.05;
  const did = post.roi - pre.roi - (control.post.roi - control.pre.roi);

  return {
    id: `${asOf}-${recommendation.id}`,
    asOf,
    t7,
    templateId: recommendation.templateId,
    templateLabel: recommendation.templateLabel,
    scope: recommendation.scope,
    scopeLine: recommendation.scopeLine,
    visible: {
      roi: pre.roi,
      cost: pre.cost,
      orders: pre.orders,
      conversions,
      goal: recommendation.goal,
      sampleAdequate: recommendation.sampleAdequate,
      dataGaps: recommendation.dataGaps,
    },
    recommendation: {
      id: recommendation.id,
      title: recommendation.title,
      suggestion: recommendation.suggestion,
      action: recommendation.action,
      effectiveAction: effective,
      expected: recommendation.expected,
      impact: recommendation.impact,
      confidence: recommendation.confidence,
    },
    hidden: {
      target: { roi: post.roi, revenue: post.revenue, cost: post.cost, orders: post.orders, gmvDelta: gmvTarget },
      control: {
        id: control.candidate.id,
        name: control.candidate.name,
        roi: control.post.roi,
        preRoi: control.pre.roi,
        revenue: control.post.revenue,
        gmvDelta: gmvControl,
      },
      did,
      gmvRelative,
      gold,
      guardrail,
    },
    calibration: predicted === null ? null : Math.abs(predicted - post.roi),
    matched: effective === gold,
    badcaseReason:
      effective === gold
        ? null
        : `建议 ${effective}，事后标签 ${gold}（DiD ${did.toFixed(2)}，GMV 相对 ${(gmvRelative * 100).toFixed(1)}%）`,
  };
}

function badcaseType(item) {
  if (!item.matched) {
    if (item.recommendation.effectiveAction === "observe") return "missed_action";
    if (item.hidden.gold === "observe") return "over_action";
    return "wrong_direction";
  }
  if (item.hidden.guardrail === false) return "guardrail_fail";
  return "ok";
}

function bootstrapCI(cases, iterations = 1000) {
  if (!cases.length) return { low: 0, high: 0 };
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const values = [];
  for (let i = 0; i < iterations; i += 1) {
    let hits = 0;
    for (let j = 0; j < cases.length; j += 1) {
      const sampled = cases[Math.floor(random() * cases.length)];
      if (sampled.matched) hits += 1;
    }
    values.push(hits / cases.length);
  }
  values.sort((a, b) => a - b);
  return {
    low: values[Math.floor(values.length * 0.025)],
    high: values[Math.floor(values.length * 0.975)],
  };
}

function goldWithThreshold(item, didThreshold, gmvThreshold) {
  if (item.visible.conversions < 20 || item.visible.cost < 3000) return "observe";
  const targetDelta = item.hidden.target.roi - item.visible.roi;
  const controlDelta = item.hidden.control.roi - item.hidden.control.preRoi;
  const did = targetDelta - controlDelta;
  if (did <= -didThreshold || item.hidden.gmvRelative <= gmvThreshold) return "reduce";
  if (did >= didThreshold && item.hidden.gmvRelative >= -0.05) return "increase";
  return "observe";
}

function sensitivityOf(cases) {
  const configs = [
    { name: "baseline (did 0.2 / GMV -8%)", did: 0.2, gmv: -0.08, guard: -0.05 },
    { name: "更严格 did 0.3", did: 0.3, gmv: -0.08, guard: -0.05 },
    { name: "更宽松 GMV -10%", did: 0.2, gmv: -0.10, guard: -0.05 },
    { name: "护栏放宽到 -10%", did: 0.2, gmv: -0.08, guard: -0.10 },
  ];
  return configs.map((config) => {
    let matched = 0;
    let safe = 0;
    let guardN = 0;
    let guardPass = 0;
    for (const item of cases) {
      const gold = goldWithThreshold(item, config.did, config.gmv);
      const action = item.recommendation.effectiveAction;
      const isMatch = action === gold;
      if (isMatch) matched += 1;
      if (action === "observe") {
        if (isMatch) safe += 1;
        continue;
      }
      guardN += 1;
      const pass = item.hidden.gmvRelative >= config.guard;
      if (pass) guardPass += 1;
      if (isMatch && pass) safe += 1;
    }
    return {
      name: config.name,
      accuracy: cases.length ? matched / cases.length : 0,
      safeAccuracy: cases.length ? safe / cases.length : 0,
      guardN,
      guardPass,
    };
  });
}

function summarize(cases) {
  const count = (predicate) => cases.filter(predicate).length;
  const accuracy = cases.length ? count((item) => item.matched) / cases.length : 0;
  const goldCounts = { observe: 0, reduce: 0, increase: 0 };
  const actionCounts = { observe: 0, reduce: 0, increase: 0 };
  const confusion = {};
  const byTemplate = {};
  const badcaseTypes = {};
  for (const item of cases) {
    goldCounts[item.hidden.gold] += 1;
    actionCounts[item.recommendation.effectiveAction] += 1;
    const key = `${item.hidden.gold}->${item.recommendation.effectiveAction}`;
    confusion[key] = (confusion[key] ?? 0) + 1;
    const template = (byTemplate[item.templateId] ??= {
      label: item.templateLabel,
      n: 0,
      matched: 0,
      safe: 0,
      guardN: 0,
      guardPass: 0,
    });
    template.n += 1;
    if (item.matched) template.matched += 1;
    if (item.hidden.guardrail !== null) {
      template.guardN += 1;
      if (item.hidden.guardrail) template.guardPass += 1;
    }
    if (item.matched && (item.hidden.guardrail === null || item.hidden.guardrail)) template.safe += 1;
    const type = badcaseType(item);
    badcaseTypes[type] = (badcaseTypes[type] ?? 0) + 1;
  }
  for (const template of Object.values(byTemplate)) {
    template.accuracy = template.n ? template.matched / template.n : 0;
    template.safeAccuracy = template.n ? template.safe / template.n : 0;
  }
  const calibration = cases.filter((item) => item.calibration !== null);
  const mae = calibration.length ? calibration.reduce((sum, item) => sum + item.calibration, 0) / calibration.length : null;
  const calibrationBins = { low: [], mid: [], high: [] };
  for (const item of calibration) {
    const predicted = item.recommendation.expected?.value;
    if (predicted < 3.5) calibrationBins.low.push(item.calibration);
    else if (predicted < 3.8) calibrationBins.mid.push(item.calibration);
    else calibrationBins.high.push(item.calibration);
  }
  const guardrails = cases.filter((item) => item.hidden.guardrail !== null);
  const violations = guardrails.filter((item) => item.hidden.guardrail === false).length;
  const safeCases = cases.filter(
    (item) => item.matched && (item.hidden.guardrail === null || item.hidden.guardrail === true),
  );
  return {
    cases: cases.length,
    accuracy,
    safeAccuracy: cases.length ? safeCases.length / cases.length : 0,
    ci: bootstrapCI(cases),
    goldCounts,
    actionCounts,
    confusion,
    byTemplate,
    badcaseTypes,
    calibrationN: calibration.length,
    mae,
    calibrationBins,
    guardrailN: guardrails.length,
    guardrailPass: guardrails.length - violations,
    violations,
    sensitivity: sensitivityOf(cases),
    baselines: {
      alwaysObserve: cases.length ? goldCounts.observe / cases.length : 0,
      alwaysReduce: cases.length ? goldCounts.reduce / cases.length : 0,
      alwaysIncrease: cases.length ? goldCounts.increase / cases.length : 0,
    },
    badcases: cases.filter((item) => !item.matched || item.hidden.guardrail === false),
  };
}

function reportMarkdown(summary, cases) {
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const avg = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const lines = [
    "# 策略实验 · 历史回放评测 v0.2",
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")} ｜ 样本：${summary.cases} 个 T0`,
    "",
    "## 1. 结论",
    "",
    `- 规则动作方向准确率：**${pct(summary.accuracy)}**（95% bootstrap CI ${pct(summary.ci.low)}–${pct(summary.ci.high)}）`,
    `- 动作方向 + 护栏都通过：**${pct(summary.safeAccuracy)}**`,
    `- baseline（永远只观察）：${pct(summary.baselines.alwaysObserve)}`,
    `- baseline（永远降预算）：${pct(summary.baselines.alwaysReduce)}`,
    `- 预测校准 MAE：${summary.mae === null ? "--" : summary.mae.toFixed(2)}（${summary.calibrationN} 条可校准）`,
    `- 真正执行动作：${summary.guardrailN} 个；通过 GMV 护栏：${summary.guardrailPass} 个；违规：${summary.violations} 个`,
    "",
    `> 读法：方向准确率 ${pct(summary.accuracy)} 低于“永远只观察” ${pct(summary.baselines.alwaysObserve)}，说明规则还不足以指导动作；真正执行动作的 ${summary.guardrailN} 个里只有 ${summary.guardrailPass} 个通过 GMV 护栏。`,
    "",
    "## 2. 事后标签分布",
    "",
    "| 事后标签 | 数量 |",
    "| --- | --- |",
    `| 只观察 | ${summary.goldCounts.observe} |`,
    `| 降预算/收缩 | ${summary.goldCounts.reduce} |`,
    `| 加预算/放量 | ${summary.goldCounts.increase} |`,
    "",
    "## 3. 分模板",
    "",
    "| 模板 | 样本 | 方向准确率 | 安全准确率 | 护栏通过/动作数 |",
    "| --- | --- | --- | --- | --- |",
    ...Object.entries(summary.byTemplate).map(
      ([id, item]) =>
        `| ${item.label}（${id}） | ${item.n} | ${pct(item.accuracy)} | ${pct(item.safeAccuracy)} | ${item.guardPass}/${item.guardN} |`,
    ),
    "",
    "## 4. 混淆矩阵",
    "",
    "| 事后标签 → 建议动作 | 数量 |",
    "| --- | --- |",
    ...Object.entries(summary.confusion).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## 5. 校准与阈值敏感性",
    "",
    "| 预测 ROI 区间 | 样本 | MAE |",
    "| --- | --- | --- |",
    `| < 3.5 | ${summary.calibrationBins.low.length} | ${avg(summary.calibrationBins.low) === null ? "--" : avg(summary.calibrationBins.low).toFixed(2)} |`,
    `| 3.5–3.8 | ${summary.calibrationBins.mid.length} | ${avg(summary.calibrationBins.mid) === null ? "--" : avg(summary.calibrationBins.mid).toFixed(2)} |`,
    `| ≥ 3.8 | ${summary.calibrationBins.high.length} | ${avg(summary.calibrationBins.high) === null ? "--" : avg(summary.calibrationBins.high).toFixed(2)} |`,
    "",
    "| 阈值配置 | 方向准确率 | 安全准确率 | 护栏通过/动作数 |",
    "| --- | --- | --- | --- |",
    ...summary.sensitivity.map(
      (item) => `| ${item.name} | ${pct(item.accuracy)} | ${pct(item.safeAccuracy)} | ${item.guardPass}/${item.guardN} |`,
    ),
    "",
    "## 6. Badcase 分类",
    "",
    "| 类型 | 数量 | 含义 |",
    "| --- | --- | --- |",
    `| missed_action | ${summary.badcaseTypes.missed_action ?? 0} | 该动但只观察 |`,
    `| over_action | ${summary.badcaseTypes.over_action ?? 0} | 不该动但建议动作 |`,
    `| wrong_direction | ${summary.badcaseTypes.wrong_direction ?? 0} | 方向反了 |`,
    `| guardrail_fail | ${summary.badcaseTypes.guardrail_fail ?? 0} | 方向对但 GMV 护栏破 |`,
    "",
    "| case | 范围 | 建议 | 事后标签 | 原因 |",
    "| --- | --- | --- | --- | --- |",
    ...summary.badcases.slice(0, 12).map(
      (item) =>
        `| ${item.id} | ${item.scopeLine} | ${item.recommendation.effectiveAction} | ${item.hidden.gold} | ${item.badcaseReason ?? "护栏违规"} |`,
    ),
    "",
    "## 7. 下一步",
    "",
    "- 给“降预算/暂停”动作加 GMV 约束：近 3 天 GMV 相对对照明显走弱时，优先只观察；",
    "- 给“加预算”动作加更严格的趋势条件，减少 reduce→increase 的误判；",
    "- 保持 60 个 case 不变，做 v0.3 规则对比，避免样本变化混淆结论；",
    "- 把同一套 case 接到 LLM Agent 上，比较“规则 vs Agent”的方向准确率与护栏通过率。",
    "",
    "## 8. 说明",
    "",
    "- 这是历史回放：只给 T0 前数据，T+7 只用于事后标签。",
    "- 对照是 T0 时相似的计划/账户，不是随机 A/B；结论是“事后相对表现”，不是严格因果。",
    "- 学习期按 `learningStartedAt` 还原；T0 有消耗的计划按“投放中”处理。",
    "- 样本不足（转化 <20/天 或 消耗 <3,000/7d）时，事后标签按“只观察”处理，和产品行为一致。",
    "- 护栏用“相对对照组的 GMV 变化”判断，避免把大盘下跌误判成 Agent 的锅。",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const mock = await loadMock();
  const today = dateKey(mock.TODAY);
  const offsets = [7, 8, 9, 10, 11, 12, 13, 14, 17, 20, 23, 26, 27, 28, 29, 30, 31, 32, 35, 38];
  const cases = [];

  for (const offset of offsets) {
    const asOf = addDays(today, -offset);
    const { recommendations } = await getRecommendations({ asOf, limit: 12, policy: "default" });
    for (const recommendation of recommendations.slice(0, 5)) {
      if (cases.length >= 60) break;
      const item = buildCase(mock, recommendation, asOf);
      if (item) cases.push(item);
    }
    if (cases.length >= 60) break;
  }

  const summary = summarize(cases);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(CASE_FILE, JSON.stringify({ generatedAt: Date.now(), cases }, null, 2), "utf8");
  fs.writeFileSync(JSON_REPORT, JSON.stringify({ generatedAt: Date.now(), summary }, null, 2), "utf8");
  fs.writeFileSync(REPORT_FILE, reportMarkdown(summary, cases), "utf8");

  console.log(`cases: ${summary.cases}`);
  console.log(`accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
  console.log(`baseline observe/reduce: ${(summary.baselines.alwaysObserve * 100).toFixed(1)}% / ${(summary.baselines.alwaysReduce * 100).toFixed(1)}%`);
  console.log(`calibration MAE: ${summary.mae === null ? "--" : summary.mae.toFixed(2)}`);
  console.log(`guardrail violations: ${summary.violations}/${summary.guardrailN}`);
  console.log(`badcases: ${summary.badcases.length}`);
  console.log(`report: ${REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
