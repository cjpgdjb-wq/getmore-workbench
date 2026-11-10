/**
 * 固定 60 case 的策略对比：v0.2 默认 / v0.3 保守 / v0.4 防守。
 *
 * 固定 case 来自 docs/eval/v0.2/cases.json，不随推荐变化而变。
 * v0.3：关闭“预算撞线 / 高 ROI 低消耗”的加预算建议。
 * v0.4：关闭高 ROI 加预算；预算撞线改为“降预算 10%”防守。
 */

import "./eval-clock.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRecommendations } from "../server/experiments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_FILE = path.join(ROOT, "docs", "eval", "v0.2", "cases.json");
const V02_REPORT = path.join(ROOT, "docs", "eval", "v0.2", "report.json");
const OUT_MD = path.join(ROOT, "docs", "eval", "policy-v0.4.md");
const OUT_JSON = path.join(ROOT, "docs", "eval", "policy-v0.4.json");

function actionBucket(recommendation) {
  if (!recommendation) return "observe";
  if (!recommendation.sampleAdequate) return "observe";
  if (recommendation.action.type === "observe") return "observe";
  const delta = Number(recommendation.action.deltaPct ?? 0);
  if (delta > 0) return "increase";
  if (delta < 0) return "reduce";
  return "observe";
}

function findPolicyRecommendation(recommendations, item) {
  const planId = item.scope.planIds?.[0] ?? null;
  return recommendations.find((recommendation) => {
    if (recommendation.templateId !== item.templateId) return false;
    if (planId) return recommendation.scope.planIds.includes(planId);
    return recommendation.scope.accountId === item.scope.accountId && recommendation.scope.planIds.length === 0;
  });
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function summarize(rows, gold, total) {
  const matched = rows.filter((row) => row.matched).length;
  const safe = rows.filter((row) => row.safe).length;
  const actions = rows.filter((row) => row.effective !== "observe");
  const guardPass = actions.filter((row) => row.guardrail).length;
  const byTemplate = {};
  for (const row of rows) {
    const entry = (byTemplate[row.templateId] ??= {
      label: row.templateLabel,
      n: 0,
      matched: 0,
      safe: 0,
      actions: 0,
      guardPass: 0,
    });
    entry.n += 1;
    if (row.matched) entry.matched += 1;
    if (row.safe) entry.safe += 1;
    if (row.effective !== "observe") {
      entry.actions += 1;
      if (row.guardrail) entry.guardPass += 1;
    }
  }
  for (const entry of Object.values(byTemplate)) {
    entry.accuracy = entry.n ? entry.matched / entry.n : 0;
    entry.safeAccuracy = entry.n ? entry.safe / entry.n : 0;
  }
  return {
    total,
    accuracy: total ? matched / total : 0,
    safeAccuracy: total ? safe / total : 0,
    actions: actions.length,
    guardPass,
    gold,
    baselineObserve: total ? gold.observe / total : 0,
    byTemplate,
  };
}

async function evaluatePolicy(cases, policy) {
  const rows = [];
  const gold = { observe: 0, reduce: 0, increase: 0 };
  for (const item of cases) {
    const { recommendations } = await getRecommendations({
      asOf: item.asOf,
      accountId: item.scope.accountId,
      limit: 20,
      policy,
      ignoreState: true,
    });
    const recommendation = findPolicyRecommendation(recommendations, item);
    const effective = actionBucket(recommendation);
    const guardrail = effective === "observe" ? null : item.hidden.gmvRelative >= -0.05;
    const matched = effective === item.hidden.gold;
    gold[item.hidden.gold] += 1;
    rows.push({
      id: item.id,
      asOf: item.asOf,
      templateId: item.templateId,
      templateLabel: item.templateLabel,
      scopeLine: item.scopeLine,
      gold: item.hidden.gold,
      effective,
      matched,
      guardrail,
      safe: matched && (guardrail === null || guardrail),
      did: item.hidden.did,
      gmvRelative: item.hidden.gmvRelative,
    });
  }
  return { rows, ...summarize(rows, gold, cases.length) };
}

function templateTable(summary) {
  return [
    "| 模板 | 样本 | 方向准确率 | 安全准确率 | 动作数 | 护栏通过 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...Object.entries(summary.byTemplate).map(
      ([id, item]) =>
        `| ${item.label}（${id}） | ${item.n} | ${pct(item.accuracy)} | ${pct(item.safeAccuracy)} | ${item.actions} | ${item.guardPass} |`,
    ),
  ];
}

async function main() {
  const payload = JSON.parse(fs.readFileSync(CASES_FILE, "utf8"));
  const cases = payload.cases ?? payload;
  const v02Summary = JSON.parse(fs.readFileSync(V02_REPORT, "utf8")).summary;
  const v03 = await evaluatePolicy(cases, "conservative");
  const v04 = await evaluatePolicy(cases, "defensive");

  const lines = [
    "# 策略实验 · 固定 case 策略对比 v0.4",
    "",
    `> 固定 ${cases.length} 个 case（v0.2 的 T0/T+7），只改策略，不换样本。`,
    "",
    "## 1. 结论",
    "",
    "| 策略 | 方向准确率 | 安全准确率 | 动作数 | 护栏通过 |",
    "| --- | --- | --- | --- | --- |",
    `| v0.2 默认规则 | ${pct(v02Summary.accuracy)} | ${pct(v02Summary.safeAccuracy)} | ${v02Summary.guardrailN} | ${v02Summary.guardrailPass} |`,
    `| v0.3 保守（关闭加预算） | ${pct(v03.accuracy)} | ${pct(v03.safeAccuracy)} | ${v03.actions} | ${v03.guardPass} |`,
    `| **v0.4 防守（预算撞线降 10%）** | **${pct(v04.accuracy)}** | **${pct(v04.safeAccuracy)}** | ${v04.actions} | ${v04.guardPass} |`,
    `| baseline 永远只观察 | ${pct(v04.baselineObserve)} | -- | 0 | -- |`,
    "",
    "## 2. v0.4 分模板",
    "",
    ...templateTable(v04),
    "",
    "## 3. 变化",
    "",
    `- 方向准确率：v0.2 ${pct(v02Summary.accuracy)} → v0.3 ${pct(v03.accuracy)} → v0.4 ${pct(v04.accuracy)}；`,
    `- 安全准确率：v0.2 ${pct(v02Summary.safeAccuracy)} → v0.3 ${pct(v03.safeAccuracy)} → v0.4 ${pct(v04.safeAccuracy)}；`,
    `- 动作数：v0.2 ${v02Summary.guardrailN} → v0.3 ${v03.actions} → v0.4 ${v04.actions}；`,
    "- v0.4 给“预算撞线”单独做了降预算 10% 的防守规则，不再只观察；",
    "- 但降预算会带来 GMV 损失，安全准确率不一定同步提升。",
    "",
    "## 4. 结论",
    "",
    "- 预算撞线不能一刀切“只观察”，也不能默认“加预算”；",
    "- v0.4 的方向准确率提升，主要来自把预算撞线从 increase 改成 reduce；",
    "- 如果安全准确率没有提升，说明“降预算”的方向对，但 GMV 护栏仍会破；",
    "- 下一版要决定：预算撞线到底优先保 ROI，还是优先保 GMV。",
    "",
    "## 5. 边界",
    "",
    "- 固定 case 来自 mock 历史回放，不是真实投放 A/B；",
    "- v0.4 是离线策略，还没有接回线上默认策略；",
    "- 结论只对这套 mock 数据和当前规则成立，不能直接外推到真实业务。",
    "",
    "## 6. 下一步",
    "",
    "- 给预算撞线加“降预算幅度”选择（-5% / -10% / 暂停），比较安全准确率；",
    "- 用同一套固定 case 做 v0.5，避免样本漂移；",
    "- 接 LLM Agent，比较“规则 vs Agent”的方向准确率与护栏通过率。",
    "",
  ];

  fs.writeFileSync(OUT_MD, lines.join("\n"), "utf8");
  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: Date.now(),
        v03: { summary: v03, rows: v03.rows },
        v04: { summary: v04, rows: v04.rows },
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`cases: ${cases.length}`);
  console.log(`v0.2: ${pct(v02Summary.accuracy)} | safe ${pct(v02Summary.safeAccuracy)}`);
  console.log(`v0.3: ${pct(v03.accuracy)} | safe ${pct(v03.safeAccuracy)} | actions ${v03.actions} | guard ${v03.guardPass}`);
  console.log(`v0.4: ${pct(v04.accuracy)} | safe ${pct(v04.safeAccuracy)} | actions ${v04.actions} | guard ${v04.guardPass}`);
  console.log(`baseline observe: ${pct(v04.baselineObserve)}`);
  console.log(`report: ${OUT_MD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
