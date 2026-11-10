import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { decorateMock } from "../server/operations.mjs";
import { runPartner } from "../server/orchestrator.mjs";
import { listDecisions } from "../server/decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = path.join(ROOT, "docs", "skills", "budget-reallocation.agent-eval.md");
const OUT_JSON = path.join(ROOT, "docs", "skills", "budget-reallocation.agent-eval.json");
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

function ratio(decision) {
  return decision.before > 0 ? decision.after / decision.before : 0;
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

function evaluateAttempt({ result, pending, error }, donorId, recipientId) {
  if (error || !result) {
    return { pass: false, passed: 0, total: 6, error: error ?? "无结果", checks: [], toolCalls: [], experts: [], pending: [] };
  }
  const { run, events } = result;
  const planEvent = events.find((event) => event.type === "plan");
  const toolCalls = events.filter((event) => event.type === "tool_call").map((event) => event.tool);
  const donorDecision = pending.find(
    (decision) => decision.targetId === donorId && decision.field === "budget" && decision.before > decision.after && ratio(decision) >= 0.85 && ratio(decision) <= 0.95,
  );
  const recipientDecision = pending.find(
    (decision) => decision.targetId === recipientId && decision.field === "budget" && decision.after > decision.before && ratio(decision) >= 1.05 && ratio(decision) <= 1.15,
  );
  const pauseDecision = pending.find((decision) => decision.tool === "pause_plan");
  const expertIds = (planEvent?.plan?.experts ?? []).map((expert) => expert.id ?? expert);
  const queryTools = toolCalls.filter((tool) => ["query_accounts", "get_budget_pacing"].includes(tool));
  const simulated = toolCalls.filter((tool) => tool === "simulate_budget_change").length;
  const finalText = String(run.synthesis ?? "");

  const checks = [
    { name: "选到 analytics + ads", pass: expertIds.includes("analytics") && expertIds.includes("ads"), actual: expertIds.join(",") },
    { name: "查了账户/预算事实", pass: queryTools.length > 0, actual: queryTools.join(",") || "无" },
    { name: "做了预算模拟", pass: simulated > 0, actual: `${simulated} 次` },
    { name: "提交 donor -10%", pass: Boolean(donorDecision), actual: donorDecision ? `${donorDecision.before} → ${donorDecision.after}` : "无" },
    { name: "提交 recipient +10%", pass: Boolean(recipientDecision), actual: recipientDecision ? `${recipientDecision.before} → ${recipientDecision.after}` : "无" },
    { name: "没有暂停提案", pass: !pauseDecision, actual: pauseDecision ? pauseDecision.tool : "无" },
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
    synthesis: finalText,
  };
}

async function main() {
  const mock = await loadMock();
  const state = decorateMock(mock);
  const donor = state.ACCOUNTS.find((account) => account.id === "1723560000014109");
  const recipient = state.ACCOUNTS.find((account) => account.id === "1723560000009224");
  if (!donor || !recipient) throw new Error("找不到预算重排示例账户");
  const range = { start: mock.DATE_KEYS[mock.DATE_KEYS.length - 7], end: mock.DATE_KEYS[mock.DATE_KEYS.length - 1] };
  const goal = `重排账户预算：donor「${donor.name}」（account_id=${donor.id}）预算降 10%；recipient「${recipient.name}」（account_id=${recipient.id}）预算加 10%。先 simulate 两侧，再提交两个待确认动作；不要暂停，不要增加总预算。`;
  const view = { channel: "auction", dimension: "account", dimensionLabel: "账户", orgName: "全部组织", range };

  const attempts = [];
  for (let index = 1; index <= ATTEMPTS; index += 1) {
    console.log(`attempt ${index}/${ATTEMPTS}...`);
    const raw = await runAttempt(goal, view);
    const evaluated = evaluateAttempt(raw, donor.id, recipient.id);
    attempts.push({ attempt: index, ...evaluated });
    console.log(`attempt ${index}: ${evaluated.passed}/${evaluated.total} ${evaluated.pass ? "PASS" : "FAIL"}${evaluated.error ? ` (${evaluated.error})` : ""}`);
  }

  const passedAttempts = attempts.filter((item) => item.pass).length;
  const summary = {
    goal,
    donor: donor.name,
    recipient: recipient.name,
    attempts: attempts.length,
    passedAttempts,
    passAt3: attempts.some((item) => item.pass),
    results: attempts,
  };

  const lines = [
    "# 预算重排 · 完整工具链评测（pass@3）",
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 1. 结果",
    "",
    `- donor：${donor.name}；recipient：${recipient.name}`,
    `- 运行：**${ATTEMPTS}** 次；通过：**${passedAttempts}/${ATTEMPTS}**；pass@3：**${summary.passAt3 ? "是" : "否"}**`,
    "",
    "| # | 通过检查 | 结果 | 专家 | 工具数 | 预算动作 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...attempts.map(
      (item) =>
        `| ${item.attempt} | ${item.passed}/${item.total} | ${item.pass ? "✅" : "❌"} | ${item.experts.join("+") || "--"} | ${item.toolCalls.length} | ${item.pending.filter((d) => d.tool === "apply_budget_change").map((d) => `${d.before}→${d.after}`).join(" / ") || "无"} |`,
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
      ...item.checks.filter((check) => !check.pass).map((check) => `- ❌ ${check.name}：${check.actual}`),
      ...(item.checks.every((check) => check.pass) ? ["- 全部检查通过"] : []),
      "",
    ]),
    "## 3. 说明",
    "",
    "- 这是完整工具链：规划 → 专家 → 工具 → 两个待确认 Decision；",
    "- 每次运行后恢复本地决策/操作/运行记录，不污染演示数据；",
    "- mock 数据，不是线上投放结果；pass@3 只覆盖单组账户。",
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
