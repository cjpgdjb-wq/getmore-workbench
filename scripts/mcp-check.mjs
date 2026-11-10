/**
 * MCP 冒烟：spawn 本地 MCP Server，tools/list + tools/call。
 * 用法：node scripts/mcp-check.mjs（MCP_MODE=off 时不跑）
 */
import assert from "node:assert/strict";
import { getMcpClient } from "../server/mcp-client.mjs";

if (process.env.MCP_MODE === "off") {
  console.log("MCP_MODE=off，跳过");
  process.exit(0);
}

const client = getMcpClient();
if (!client) {
  console.error("MCP client 不可用（spawn 失败）");
  process.exit(1);
}

try {
  const tools = await client.listTools();
  assert.equal(tools.length, 16, `MCP tools 应为 16，实际 ${tools.length}`);
  assert.ok(tools.some((tool) => tool.name === "query_plans"), "缺少 query_plans");
  assert.ok(tools.some((tool) => tool.name === "forecast_plan"), "缺少 forecast_plan");

  const accounts = await client.callTool("query_accounts", { channel: "auction", limit: 3 }, { expertId: "analytics" });
  assert.equal(accounts.ok, true, "query_accounts 失败");
  assert.ok(Array.isArray(accounts.result?.accounts), "query_accounts 返回结构不对");

  const forecast = await client.callTool(
    "forecast_plan",
    { plan_id: "1739810000007919", horizon_days: 7 },
    { expertId: "ads" },
  );
  assert.equal(forecast.ok, true, "forecast_plan 失败");
  assert.ok(forecast.result?.range?.roiLow != null, "forecast 缺少区间");

  console.log(`MCP tools: ${tools.length}`);
  console.log(`query_accounts: ${accounts.result.accounts.length} accounts`);
  console.log(`forecast_plan: ROI ${forecast.result.range.roiLow}–${forecast.result.range.roiHigh}`);
  process.exit(0);
} finally {
  client.close();
}
