import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { decorateMock } from "../server/operations.mjs";
import { runPartner } from "../server/orchestrator.mjs";
import { listDecisions } from "../server/decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = path.join(ROOT, "docs", "skills", "weekly-review.agent-eval.md");
const OUT_JSON = path.join(ROOT, "docs", "skills", "weekly-review.agent-eval.json");
const ATTEMPTS = 3;
const FILES = ["decisions.json", "operations.json", "runs.json", "memory.json"].map((name) =>
  path.join(ROOT, ".runtime", "partner", name),
);

function backup() {
  return new Map(FILES.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null]));
}

function restore(snapshot) {
  for (const [file, content] of snapshot) {
    if (content === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, content, "utf8");
    }
  }
}

async function runAttempt(goal, view) {
  const snapshot = backup();
  let result = null;
  let pending = [];
  let error = null;
  try {
    result = await runPartner({ goal, view, emit: () => {} });
    pending = listDecisions({ runId: result.run.id, status: "pending" });
  } catch (err) {
    error = err instanceof Error ? err.message : "运行失败";
  } finally {
    restore(snapshot);
  }
  return { result, pending, error };
}

function evaluateAttempt({ result, pending, error }) {
  if (error || !result) {
    return { pass: false, passed: 0, total: 4, error: error ?? "无结果", checks: [], pending: [], synthesis: "", experts: [] };
  }
  const { run, events } = result;
  const planEvent = events.find((event) => event.type === "plan");
  const expertIds = (planEvent?.plan?.experts ?? []).map((expert) => expert.id ?? expert);
  const synthesis = String(run.synthesis ?? "");
  const hasNumbers = /(\d[\d,.]*\s*(元|万|%|单|天))|ROI|GMV/i.test(synthesis);
  const hasReport = /本周|周报/.test(synthesis) && /下周|数据缺口/.test(synthesis);

  const checks = [
    { name: "选到分析专家", pass: expertIds.includes("analytics"), actual: expertIds.join(",") },
    { name: "输出周报结构", pass: hasReport, actual: hasReport ? "本周/下周或数据缺口" : "缺" },
    { name: "带数字", pass: hasNumbers, actual: hasNumbers ? "是" : "否" },
    { name: "不提交 Decision", pass: pending.length === 0, actual: pending.length ? `${pending.length} 个` : "无" },
  ];

  return {
    pass: checks.every((check) => check.pass),
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
    error: null,
    checks,
    pending: pending.map((decision) => decision.tool),
    synthesis,
    experts: expertIds,
  };
}

async function main() {
  const mock = await loadMock();
  const range = { start: mock.DATE_KEYS[mock.DATE_KEYS.length - 7], end: mock.DATE_KEYS[mock.DATE_KEYS.length - 1] };
  const goal = "写本周投放周报：基于当前看板，输出本周总览、本周 vs 上周、3 个关键变化、2 个下周动作、数据缺口；只读，不提交任何动作。";
  const view = { channel: "auction", dimension: "account", dimensionLabel: "账户", orgName: "全部组织", range };

  const attempts = [];
  for (let index = 1; index <= ATTEMPTS; index += 1) {
    console.log(`attempt ${index}/${ATTEMPTS}...`);
    const raw = await runAttempt(goal, view);
    const evaluated = evaluateAttempt(raw);
    attempts.push({ attempt: index, ...evaluated });
    console.log(`attempt ${index}: ${evaluated.passed}/${evaluated.total} ${evaluated.pass ? "PASS" : "FAIL"}${evaluated.error ? ` (${evaluated.error})` : ""}`);
  }

  const passedAttempts = attempts.filter((item) => item.pass).length;
  const summary = { goal, attempts: attempts.length, passedAttempts, passAt3: attempts.some((item) => item.pass), results: attempts };

  const lines = [
    "# 周报复盘 · 只读评测（pass@3）",
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 1. 结果",
    "",
    `- 运行：**${ATTEMPTS}** 次；通过：**${passedAttempts}/${ATTEMPTS}**；pass@3：**${summary.passAt3 ? "是" : "否"}**`,
    "",
    "| # | 通过检查 | 结果 | 专家 | Decision |",
    "| --- | --- | --- | --- | --- |",
    ...attempts.map(
      (item) => `| ${item.attempt} | ${item.passed}/${item.total} | ${item.pass ? "✅" : "❌"} | ${item.experts.join("+") || "--"} | ${item.pending.join(" / ") || "无"} |`,
    ),
    "",
    "## 2. 每次运行",
    "",
    ...attempts.flatMap((item) => [
      `### 第 ${item.attempt} 次：${item.passed}/${item.total} ${item.pass ? "通过" : "失败"}`,
      "",
      ...item.checks.filter((check) => !check.pass).map((check) => `- ❌ ${check.name}：${check.actual}`),
      ...(item.checks.every((check) => check.pass) ? ["- 全部检查通过"] : []),
      "",
    ]),
    "## 3. 说明",
    "",
    "- 这是只读工作流：只检查周报结构和数字，不检查 Decision；",
    "- 每次运行后恢复本地运行记录；",
    "- mock 数据，不是线上周报。",
    "",
  ];

  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: Date.now(), summary }, null, 2), "utf8");
  fs.writeFileSync(OUT_MD, lines.join("\n"), "utf8");
  console.log(`passed: ${passedAttempts}/${ATTEMPTS} | pass@3: ${summary.passAt3 ? "yes" : "no"}`);
  console.log(`report: ${OUT_MD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
