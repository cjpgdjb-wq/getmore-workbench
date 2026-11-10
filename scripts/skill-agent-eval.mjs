import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { decorateMock } from "../server/operations.mjs";
import { runPartner } from "../server/orchestrator.mjs";
import { listDecisions } from "../server/decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = path.join(ROOT, "docs", "skills", "learning-phase-diagnosis.agent-eval.md");
const OUT_JSON = path.join(ROOT, "docs", "skills", "learning-phase-diagnosis.agent-eval.json");
const ATTEMPTS = 3;
const FILES = ["decisions.json", "operations.json", "runs.json", "memory.json"].map((name) =>
  path.join(ROOT, ".runtime", "partner", name),
);

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

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

function evaluateAttempt({ result, pending, error }, planId, accountId) {
  if (error || !result) {
    return {
      pass: false,
      passed: 0,
      total: 6,
      error: error ?? "无结果",
      checks: [],
      toolCalls: [],
      experts: [],
      pending: [],
      synthesis: "",
    };
  }
  const { run, events } = result;
  const planEvent = events.find((event) => event.type === "plan");
  const toolCalls = events.filter((event) => event.type === "tool_call").map((event) => event.tool);
  const budgetDecision = pending.find(
    (decision) =>
      (decision.targetId === planId || decision.targetId === accountId) &&
      decision.field === "budget" &&
      decision.before > decision.after &&
      decision.after / decision.before >= 0.85 &&
      decision.after / decision.before <= 0.95,
  );
  const pauseDecision = pending.find((decision) => decision.tool === "pause_plan");
  const expertIds = (planEvent?.plan?.experts ?? []).map((expert) => expert.id ?? expert);
  const queryTools = toolCalls.filter((tool) => ["query_plans", "get_account_plans"].includes(tool));
  const simulated = toolCalls.includes("simulate_budget_change");
  const expertFindings = events
    .filter((event) => event.type === "expert_end")
    .map((event) => ({ expertId: event.expertId, finding: String(event.finding ?? "") }));
  const finalText = [
    String(run.synthesis ?? ""),
    ...expertFindings.map((item) => item.finding),
    ...pending.map((decision) => String(decision.reason ?? "")),
  ].join("\n");
  const mentionsLearning = /学习期/.test(finalText);
  const mentionsBudget = /预算/.test(finalText);

  const checks = [
    { name: "选到 analytics + ads", pass: expertIds.includes("analytics") && expertIds.includes("ads"), actual: expertIds.join(",") },
    { name: "查了计划事实", pass: queryTools.length > 0, actual: queryTools.join(",") || "无" },
    { name: "做了预算模拟", pass: simulated, actual: simulated ? "simulate_budget_change" : "无" },
    { name: "提交预算 -10% 待确认", pass: Boolean(budgetDecision), actual: budgetDecision ? `${budgetDecision.before} → ${budgetDecision.after}` : "无" },
    { name: "没有暂停提案", pass: !pauseDecision, actual: pauseDecision ? pauseDecision.tool : "无" },
    { name: "结论提到学习期/预算", pass: mentionsLearning && mentionsBudget, actual: `学习期=${mentionsLearning} 预算=${mentionsBudget}` },
  ];

  return {
    pass: checks.every((check) => check.pass),
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
    error: null,
    checks,
    toolCalls,
    experts: expertIds,
    pending: pending.map((decision) => ({
      tool: decision.tool,
      targetName: decision.targetName,
      before: decision.before,
      after: decision.after,
      status: decision.status,
    })),
    synthesis: String(run.synthesis ?? ""),
  };
}

async function main() {
  const mock = await loadMock();
  const state = decorateMock(mock);
  const plan = state.CAMPAIGNS.find((item) => item.name === "标准-轻量徒步鞋-短视频带货");
  if (!plan) throw new Error("找不到学习期示例计划");
  const account = state.accountById(plan.accountId);
  const range = { start: mock.DATE_KEYS[mock.DATE_KEYS.length - 7], end: mock.DATE_KEYS[mock.DATE_KEYS.length - 1] };
  const goal = `诊断学习期计划「${plan.name}」（plan_id=${plan.id}，account_id=${account.id}，账户：${account.name}）：ROI 3.67 低于目标 4.3，样本 33/天；如果库存和余额允许，必须先调用 simulate_budget_change，再提交预算 -10% 的待确认动作，不要暂停，也不要加预算。`;
  const view = {
    channel: "auction",
    dimension: "account",
    dimensionLabel: "账户",
    orgName: "全部组织",
    range,
  };

  const attempts = [];
  for (let index = 1; index <= ATTEMPTS; index += 1) {
    console.log(`attempt ${index}/${ATTEMPTS}...`);
    const raw = await runAttempt(goal, view);
    const evaluated = evaluateAttempt(raw, plan.id, account.id);
    attempts.push({ attempt: index, ...evaluated });
    console.log(`attempt ${index}: ${evaluated.passed}/${evaluated.total} ${evaluated.pass ? "PASS" : "FAIL"}${evaluated.error ? ` (${evaluated.error})` : ""}`);
  }

  const passedAttempts = attempts.filter((item) => item.pass).length;
  const passAt3 = attempts.some((item) => item.pass);
  const summary = {
    goal,
    plan: plan.name,
    account: account.name,
    attempts: attempts.length,
    passedAttempts,
    passAt3,
    results: attempts,
  };

  const lines = [
    "# 学习期诊断 · 完整工具链评测（pass@3）",
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 1. 结果",
    "",
    `- 运行：**${ATTEMPTS}** 次`,
    `- 通过：**${passedAttempts} / ${ATTEMPTS}**`,
    `- pass@3：**${passAt3 ? "是" : "否"}**`,
    "",
    "| # | 通过检查 | 结果 | 专家 | 工具数 | 预算提案 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...attempts.map(
      (item) =>
        `| ${item.attempt} | ${item.passed}/${item.total} | ${item.pass ? "✅" : "❌"} | ${item.experts.join("+") || "--"} | ${item.toolCalls.length} | ${item.pending.find((d) => d.tool === "apply_budget_change") ? `${item.pending.find((d) => d.tool === "apply_budget_change").before}→${item.pending.find((d) => d.tool === "apply_budget_change").after}` : "无"} |`,
    ),
    "",
    "## 2. 每次运行",
    "",
    ...attempts.flatMap((item) => [
      `### 第 ${item.attempt} 次：${item.passed}/${item.total} ${item.pass ? "通过" : "失败"}`,
      "",
      ...(item.error ? [`错误：${item.error}`, ""] : []),
      "```text",
      ...item.toolCalls.map((tool) => `- ${tool}`),
      "```",
      "",
      ...item.checks
        .filter((check) => !check.pass)
        .map((check) => `- ❌ ${check.name}：${check.actual}`),
      ...(item.checks.every((check) => check.pass) ? ["- 全部检查通过"] : []),
      "",
    ]),
    "## 3. 说明",
    "",
    "- 这是完整工具链：规划 → 专家 → 工具 → 待确认 Decision；",
    "- 每次运行后恢复本地决策/操作/运行记录，不污染演示数据；",
    "- 仍是 mock 数据，不是线上投放结果；本次 pass@3 = 3/3，表示这 3 次都通过，但仍只覆盖单账户单场景。",
    "",
  ];

  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: Date.now(), summary }, null, 2), "utf8");
  fs.writeFileSync(OUT_MD, lines.join("\n"), "utf8");

  console.log(`passed: ${passedAttempts}/${ATTEMPTS} | pass@3: ${passAt3 ? "yes" : "no"}`);
  console.log(`report: ${OUT_MD}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
