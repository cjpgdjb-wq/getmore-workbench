/**
 * 真实模型冒烟：问“接下来 7 天怎么走”，确认 Agent 会调用 forecast_plan，
 * 并在最终回复里给出区间、置信度、验证点、回滚。
 *
 * 用法：node scripts/forecast-agent-smoke.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMock } from "../server/mock.mjs";
import { runPartner } from "../server/orchestrator.mjs";
import { listDecisions } from "../server/decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = ["runs.json", "decisions.json", "operations.json", "memory.json"].map((name) =>
  path.join(ROOT, ".runtime", "partner", name),
);
const snapshot = new Map(RUNTIME.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null]));

function restore() {
  for (const [file, content] of snapshot) {
    if (content == null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, content, "utf8");
  }
}

const mock = await loadMock();
const authorized = new Set(
  mock.ACCOUNTS.filter((account) => account.authorization === "已授权" && account.dataSources.includes("商品交易")).map(
    (account) => account.id,
  ),
);
const plan = mock.CAMPAIGNS.find(
  (campaign) => authorized.has(campaign.accountId) && campaign.daily.at(-1)?.cost > 0,
);
if (!plan) throw new Error("找不到可预测的计划");
const goal = `${plan.name}（plan_id=${plan.id}）接下来 7 天会怎么走？请给出预测区间、建议动作、置信度、3 天后的验证点和回滚条件。`;

let run;
let events = [];
let pending = 0;
try {
  const result = await runPartner({
    goal,
    view: {
      channel: "auction",
      dimension: "account",
      dimensionLabel: "账户",
      orgName: "全部组织",
      accountId: plan.accountId,
    },
    emit: () => {},
  });
  run = result.run;
  events = result.events;
  pending = listDecisions({ runId: run.id, status: "pending" }).length;
} finally {
  restore();
}

const toolCalls = events.filter((event) => event.type === "tool_call").map((event) => event.tool);
const calledForecast = toolCalls.includes("forecast_plan");
const synthesis = String(run.synthesis ?? "");

console.log(`plan: ${plan.name} (${plan.id})`);
console.log(`tool calls: ${toolCalls.join(" → ") || "（无）"}`);
console.log(`叫了 forecast_plan: ${calledForecast}`);
console.log(`pending: ${pending}`);
console.log("\n--- synthesis ---\n");
console.log(synthesis.slice(0, 1800));
process.exit(calledForecast ? 0 : 1);
