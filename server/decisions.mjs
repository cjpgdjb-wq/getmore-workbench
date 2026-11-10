import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOperation, EXECUTION_GUARDRAILS } from "./operations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "decisions.json");

export const DECISION_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_PER_RUN = EXECUTION_GUARDRAILS.maxOperationsPerRun;

function read() {
  fs.mkdirSync(DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed.decisions)) return parsed;
  } catch {
    /* first run */
  }
  return { decisions: [] };
}

function write(state) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ decisions: state.decisions.slice(-300) }, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

function uid() {
  return `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function expire(state) {
  const now = Date.now();
  let changed = false;
  for (const decision of state.decisions) {
    if (decision.status === "pending" && decision.expiresAt <= now) {
      decision.status = "expired";
      decision.decidedAt = now;
      changed = true;
    }
  }
  if (changed) write(state);
}

function signature(input) {
  return [
    input.runId,
    input.tool,
    input.targetType,
    input.targetId,
    input.field,
    String(input.before),
    String(input.after),
  ].join("|");
}

export function listDecisions({ runId, workspaceId, status, limit = 50 } = {}) {
  const state = read();
  expire(state);
  return state.decisions
    .filter(
      (decision) =>
        (!runId || decision.runId === runId) &&
        (!workspaceId || decision.workspaceId === workspaceId) &&
        (!status || decision.status === status),
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function getDecision(id) {
  const state = read();
  expire(state);
  return state.decisions.find((decision) => decision.id === id) ?? null;
}

export function pendingCount(runId) {
  return listDecisions({ runId, status: "pending" }).length;
}

/**
 * Agent 只能创建提案，不能写投放。
 * 这里仍会做一次护栏校验，避免把明显违规的动作放进待确认队列。
 */
export function createDecision(input) {
  const state = read();
  expire(state);
  const pending = state.decisions.filter(
    (decision) => decision.runId === input.runId && decision.status === "pending",
  );
  if (pending.length >= MAX_PENDING_PER_RUN) {
    return { ok: false, error: `单次任务最多提交 ${MAX_PENDING_PER_RUN} 个待确认动作` };
  }
  const key = signature(input);
  const duplicate = pending.find((decision) => signature(decision) === key);
  if (duplicate) {
    return { ok: true, decision: duplicate, duplicate: true, message: "相同动作已在待确认队列中" };
  }

  const now = Date.now();
  const decision = {
    id: uid(),
    runId: input.runId,
    workspaceId: input.workspaceId ?? null,
    productId: input.productId ?? null,
    accountId: input.accountId ?? null,
    experimentId: input.experimentId ?? null,
    allowedPlanIds: Array.isArray(input.allowedPlanIds) ? input.allowedPlanIds.slice(0, 50) : [],
    tool: input.tool,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    field: input.field,
    before: input.before,
    after: input.after,
    unit: input.unit ?? "",
    reason: String(input.reason ?? "").slice(0, 400),
    evidence: Array.isArray(input.evidence) ? input.evidence.slice(0, 8) : [],
    dataGaps: Array.isArray(input.dataGaps) ? input.dataGaps.slice(0, 5) : [],
    expected: input.expected ?? null,
    riskLevel: input.riskLevel ?? "medium",
    riskText: input.riskText ?? "",
    status: "pending",
    requestedBy: "agent",
    createdAt: now,
    expiresAt: now + DECISION_TTL_MS,
    decidedBy: null,
    decidedAt: null,
    comment: "",
    operationId: null,
  };
  state.decisions.push(decision);
  write(state);
  return { ok: true, decision };
}

export function approveDecision(id, { comment = "", by = "优化师" } = {}) {
  const state = read();
  expire(state);
  const decision = state.decisions.find((item) => item.id === id);
  if (!decision) return { ok: false, error: "待确认动作不存在" };
  if (decision.status === "approved") {
    return { ok: true, decision, operation: null, already: true };
  }
  if (decision.status === "rejected") return { ok: false, error: "该动作已被拒绝，不能执行" };
  if (decision.status === "expired") return { ok: false, error: "该动作已过期，请让 Agent 重新提交" };
  if (decision.status !== "pending") return { ok: false, error: "当前状态不可执行" };
  if (decision.workspaceId) {
    if (decision.targetType === "account" && decision.accountId && decision.targetId !== decision.accountId) {
      return { ok: false, error: "动作目标不在当前商品工作区账户范围内" };
    }
    if (
      decision.targetType === "plan" &&
      Array.isArray(decision.allowedPlanIds) &&
      decision.allowedPlanIds.length > 0 &&
      !decision.allowedPlanIds.includes(decision.targetId)
    ) {
      return { ok: false, error: "动作目标不在当前商品工作区计划范围内" };
    }
  }

  const applied = applyOperation({
    runId: decision.runId,
    experimentId: decision.experimentId ?? null,
    tool: decision.tool,
    targetType: decision.targetType,
    targetId: decision.targetId,
    targetName: decision.targetName,
    field: decision.field,
    before: decision.before,
    after: decision.after,
    unit: decision.unit,
    reason: decision.reason,
    expected: decision.expected,
  });
  if (!applied.ok) return applied;

  decision.status = "approved";
  decision.decidedBy = by;
  decision.decidedAt = Date.now();
  decision.comment = String(comment ?? "").slice(0, 300);
  decision.operationId = applied.operation.id;
  write(state);
  return { ok: true, decision, operation: applied.operation };
}

export function rejectDecision(id, { comment = "", by = "优化师" } = {}) {
  const state = read();
  expire(state);
  const decision = state.decisions.find((item) => item.id === id);
  if (!decision) return { ok: false, error: "待确认动作不存在" };
  if (decision.status === "rejected") return { ok: true, decision };
  if (decision.status !== "pending") return { ok: false, error: "当前状态不可拒绝" };
  decision.status = "rejected";
  decision.decidedBy = by;
  decision.decidedAt = Date.now();
  decision.comment = String(comment ?? "").slice(0, 300);
  write(state);
  return { ok: true, decision };
}
