import assert from "node:assert/strict";

const BASE = process.env.PARTNER_URL ?? "http://127.0.0.1:5180";
const PRODUCT_ID = "prod_1723560000006293_4";

async function json(path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

const proposed = await json("/partner/workspace/propose", {
  method: "POST",
  body: JSON.stringify({
    workspaceId: `ws_hitl_${Date.now().toString(36)}`,
    productId: PRODUCT_ID,
    message: "把当前账户日预算提高 5%，提交待我确认，不要直接执行。",
    assistantText: "建议根据近 7 天 ROI 和库存决定是否加预算。",
    permission: "suggest",
  }),
});
assert.equal(proposed.response.status, 200);
assert.equal(proposed.body.ok, true);
assert.ok(Array.isArray(proposed.body.decisions));
assert.ok(proposed.body.decisions.length >= 1, `no decision: ${JSON.stringify(proposed.body)}`);
const decision = proposed.body.decisions[0];
assert.equal(decision.status, "pending");
assert.ok(decision.workspaceId);
assert.ok(Array.isArray(decision.allowedPlanIds));

const approved = await json(`/partner/decisions/${decision.id}/approve`, {
  method: "POST",
  body: JSON.stringify({ comment: "workspace HITL smoke" }),
});
assert.equal(approved.body.ok, true);
assert.equal(approved.body.decision.status, "approved");
assert.ok(approved.body.operation?.id);

const undo = await json(`/partner/operations/${approved.body.operation.id}/undo`, {
  method: "POST",
  body: "{}",
});
assert.equal(undo.body.ok, true);

console.log("workspace HITL check passed");
console.log("proposal:", decision.targetName, decision.before, "→", decision.after);
console.log("operation:", approved.body.operation.id);

// Regression: “提高日投放百分之十” must map to a plan budget decision,
// including brand plans where payment ROI is unavailable.
const planProposal = await json("/partner/workspace/propose", {
  method: "POST",
  body: JSON.stringify({
    workspaceId: `ws_hitl_plan_${Date.now().toString(36)}`,
    productId: "prod_1798310000003412_2",
    message: "提高日投放百分之十",
    assistantText: "计划 1764920000021055 日预算 20,843 → 22,927（+10%），品牌曝光无支付归因。",
    permission: "suggest",
  }),
});
assert.equal(planProposal.response.status, 200);
assert.ok(planProposal.body.decisions?.length >= 1, `no plan decision: ${JSON.stringify(planProposal.body)}`);
const planDecision = planProposal.body.decisions[0];
assert.equal(planDecision.targetType, "plan");
assert.equal(planDecision.field, "budget");
assert.equal(planDecision.targetId, "1764920000021055");
assert.ok(Array.isArray(planDecision.allowedPlanIds));
const planApproved = await json(`/partner/decisions/${planDecision.id}/approve`, {
  method: "POST",
  body: JSON.stringify({ comment: "plan budget smoke" }),
});
assert.equal(planApproved.body.ok, true);
assert.equal(planApproved.body.operation?.target_type, "plan");
assert.equal(planApproved.body.operation?.field, "budget");
await json(`/partner/operations/${planApproved.body.operation.id}/undo`, {
  method: "POST",
  body: "{}",
});
console.log("plan budget proposal:", planDecision.before, "→", planDecision.after);

