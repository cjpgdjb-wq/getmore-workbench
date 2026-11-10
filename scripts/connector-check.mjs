/**
 * 校验 connector 适配层：
 * - 16 个业务工具都有 connector；
 * - 每个 connector 有风险、专家绑定、授权状态；
 * - 读写分级正确；
 * - 每个专家的 connector 清单 = 它的工具清单。
 */
import assert from "node:assert/strict";
import { listConnectors, connectorById, connectorsForExpert, CONNECTOR_AUTH } from "../server/connectors.mjs";
import { EXPERTS } from "../server/tools.mjs";

const connectors = listConnectors();
assert.equal(connectors.length, 16, "应该有 16 个业务连接器");
assert.equal(connectorById("pause_plan")?.risk, "destructive", "pause_plan 应为 destructive");
assert.equal(connectorById("apply_budget_change")?.risk, "write", "apply_budget_change 应为 write");
assert.equal(connectorById("query_plans")?.risk, "read", "query_plans 应为 read");
assert.equal(connectorById("pause_plan")?.requiresApproval, true, "写连接器需要确认");
assert.equal(CONNECTOR_AUTH.mode, "mock", "演示环境授权应为 mock");

for (const connector of connectors) {
  assert.ok(connector.id && connector.name, `${connector.id} 缺少 id/name`);
  assert.ok(connector.description, `${connector.id} 缺少 description`);
  assert.ok(Array.isArray(connector.expertIds) && connector.expertIds.length > 0, `${connector.id} 缺少 expertIds`);
  assert.ok(["read", "write", "destructive"].includes(connector.risk), `${connector.id} 风险不合法`);
  assert.equal(connector.auth.status, "connected", `${connector.id} 授权状态异常`);
}

for (const expert of EXPERTS) {
  const expected = expert.tools.map((tool) => tool.name).sort();
  const actual = connectorsForExpert(expert.id).map((connector) => connector.id).sort();
  assert.deepEqual(actual, expected, `${expert.id} connector 与工具不一致`);
  if (expert.id === "opportunity") {
    assert.ok(connectorsForExpert(expert.id).every((connector) => connector.risk === "read"), "机会洞察不应有写连接器");
  }
}

console.log(`connectors: ${connectors.length} | auth: ${CONNECTOR_AUTH.mode}/${CONNECTOR_AUTH.status}`);
console.log(`read: ${connectors.filter((item) => item.risk === "read").length} | write: ${connectors.filter((item) => item.risk === "write").length} | destructive: ${connectors.filter((item) => item.risk === "destructive").length}`);
console.log("connector check passed");
