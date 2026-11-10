import assert from "node:assert/strict";
import { createDecision } from "../server/decisions.mjs";

const BASE = process.env.PARTNER_URL ?? "http://127.0.0.1:5180";

async function json(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  return { response, body };
}

const pending = createDecision({
  runId: `run_hitl_check_${Date.now().toString(36)}`,
  tool: "apply_budget_change",
  action: "调整日预算",
  targetType: "account",
  targetId: "1723560000004339",
  targetName: "轻氧家居旗舰店",
  field: "budget",
  before: 10000,
  after: 10500,
  unit: "元/日",
  reason: "HITL regression: 确认路径",
  evidence: ["近 7 天 ROI 3.41", "调整幅度 +5%"],
  dataGaps: [],
  expected: { label: "整体支付ROI", value: 3.4, unit: "", text: "预算 10,000 → 10,500" },
  riskLevel: "medium",
});
assert.equal(pending.ok, true);
assert.equal(pending.decision.status, "pending");

const listed = await json(`/partner/decisions?status=pending&runId=${pending.decision.runId}`);
assert.ok(listed.body.decisions.some((item) => item.id === pending.decision.id));

const approve = await json(`/partner/decisions/${pending.decision.id}/approve`, {
  method: "POST",
  body: JSON.stringify({ comment: "HITL regression approve" }),
});
assert.equal(approve.body.ok, true);
assert.equal(approve.body.decision.status, "approved");
assert.ok(approve.body.operation?.id);

const operations = await json("/partner/operations");
assert.ok(operations.body.operations.some((item) => item.id === approve.body.operation.id));

const undo = await json(`/partner/operations/${approve.body.operation.id}/undo`, {
  method: "POST",
  body: "{}",
});
assert.equal(undo.body.ok, true);

const rejected = createDecision({
  runId: `run_hitl_reject_${Date.now().toString(36)}`,
  tool: "pause_plan",
  action: "暂停计划",
  targetType: "plan",
  targetId: "1739810000032902",
  targetName: "全域-轻盈鹅绒被-短视频带货",
  field: "status",
  before: "投放中",
  after: "已暂停",
  reason: "HITL regression: 拒绝路径",
  evidence: ["ROI 3.1"],
  dataGaps: [],
  riskLevel: "high",
});
const reject = await json(`/partner/decisions/${rejected.decision.id}/reject`, {
  method: "POST",
  body: JSON.stringify({ comment: "HITL regression reject" }),
});
assert.equal(reject.body.ok, true);
assert.equal(reject.body.decision.status, "rejected");

const afterReject = await json(`/partner/decisions/${rejected.decision.id}`);
assert.equal(afterReject.body.decision.status, "rejected");
assert.equal(afterReject.body.decision.operationId, null);

console.log("HITL check passed");
console.log("approve:", approve.body.decision.id, "→", approve.body.operation.id);
console.log("reject:", rejected.decision.id);
