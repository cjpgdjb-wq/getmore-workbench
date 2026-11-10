import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { decorateMock } from "../server/operations.mjs";
import { runPartner } from "../server/orchestrator.mjs";
import { listDecisions } from "../server/decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = path.join(ROOT, "docs", "skills", "creative-reject-guard.agent-eval.md");
const OUT_JSON = path.join(ROOT, "docs", "skills", "creative-reject-guard.agent-eval.json");
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

function evaluateAttempt({ result, pending, error }, planId) {
  if (error || !result) {
    return { pass: false, passed: 0, total: 5, error: error ?? "无结果", checks: [], toolCalls: [], experts: [], pending: [], synthesis: "" };
  }
  const { run, events } = result;
  const planEvent = events.find((event) => event.type === "plan");
  const toolCalls = events.filter((event) => event.type === "tool_call").map((event) => event.tool);
  const pauseDecision = pending.find((decision) => decision.targetId === planId && decision.tool === "pause_plan");
  const budgetDecision = pending.find((decision) => decision.field === "budget");
  const expertIds = (planEvent?.plan?.experts ?? []).map((expert) => expert.id ?? expert);
  const queryTools = toolCalls.filter((tool) => ["query_plans", "get_account_plans"].includes(tool));
  const expertFindings = events.filter((event) => event.type === "expert_end").map((event) => String(event.finding ?? ""));
  const finalText = [String(run.synthesis ?? ""), ...expertFindings].join("\n");
  const mentionsCreative = /拒审|素材/.test(finalText);

  const checks = [
    { name: "选到 analytics + ads", pass: expertIds.includes("analytics") && expertIds.includes("ads"), actual: expertIds.join(",") },
    { name: "查了计划/素材", pass: queryTools.length > 0, actual: queryTools.join(",") || "无" },
    { name: "提交暂停", pass: Boolean(pauseDecision), actual: pauseDecision ? "pause_plan" : "无" },
    { name: "没有预算动作", pass: !budgetDecision, actual: budgetDecision ? "budget" : "无" },
    { name: "结论提到拒审/素材", pass: mentionsCreative, actual: mentionsCreative ? "是" : "否" },
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
  const plan = state.CAMPAIGNS.find((item) => item.id === "1739810000071271");
  if (!plan) throw new Error("找不到全部拒审示例计划");
  const account = state.accountById(plan.accountId);
  const range = { start: mock.DATE_KEYS[mock.DATE_KEYS.length - 7], end: mock.DATE_KEYS[mock.DATE_KEYS.length - 1] };
  const goal = `素材拒审止损：计划「${plan.name}」（plan_id=${plan.id}，account_id=${account.id}，账户：${account.name}）唯一素材被拒审（背景音乐版权待确认），计划仍在消耗约 1.54 万。请查计划/素材审核，如果全部素材拒审，提交暂停的待确认动作；不要加预算。`;
  const view = { channel: "auction", dimension: "account", dimensionLabel: "账户", orgName: "全部组织", range };

  const attempts = [];
  for (let index = 1; index <= ATTEMPTS; index += 1) {
    console.log(`attempt ${index}/${ATTEMPTS}...`);
    const raw = await runAttempt(goal, view);
    const evaluated = evaluateAttempt(raw, plan.id);
    attempts.push({ attempt: index, ...evaluated });
    console.log(`attempt ${index}: ${evaluated.passed}/${evaluated.total} ${evaluated.pass ? "PASS" : "FAIL"}${evaluated.error ? ` (${evaluated.error})` : ""}`);
  }

  const passedAttempts = attempts.filter((item) => item.pass).length;
  const summary = {
    goal,
    plan: plan.name,
    account: account.name,
    attempts: attempts.length,
    passedAttempts,
    passAt3: attempts.some((item) => item.pass),
    results: attempts,
  };

  const lines = [
    "# 素材拒审止损 · 完整工具链评测（pass@3）",
    "",
    `> 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "## 1. 结果",
    "",
    `- 计划：${plan.name}（${account.name}）`,
    `- 运行：**${ATTEMPTS}** 次；通过：**${passedAttempts}/${ATTEMPTS}**；pass@3：**${summary.passAt3 ? "是" : "否"}**`,
    "",
    "| # | 通过检查 | 结果 | 专家 | 工具数 | 动作 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...attempts.map(
      (item) =>
        `| ${item.attempt} | ${item.passed}/${item.total} | ${item.pass ? "✅" : "❌"} | ${item.experts.join("+") || "--"} | ${item.toolCalls.length} | ${item.pending.map((d) => d.tool).join(" / ") || "无"} |`,
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
    "- 完整工具链：规划 → 专家 → 查计划/素材 → 待确认暂停；",
    "- 每次运行后恢复本地决策/操作/运行记录；",
    "- mock 数据，不是线上审核；pass@3 只覆盖单个全部拒审计划。",
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

