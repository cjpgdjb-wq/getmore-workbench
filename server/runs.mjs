import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDecisions } from "./decisions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "runs.json");

function read() {
  fs.mkdirSync(DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed.runs)) return parsed;
  } catch {
    /* first run */
  }
  return { runs: [] };
}

function write(state) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ runs: state.runs.slice(0, 24) }, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

export function uid(prefix = "run") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function saveRun(run) {
  const state = read();
  const index = state.runs.findIndex((item) => item.id === run.id);
  if (index >= 0) state.runs[index] = run;
  else state.runs.unshift(run);
  write(state);
  return run;
}

export function listRuns(limit = 24) {
  return read()
    .runs.slice(0, limit)
    .map((run) => {
      const tools = (run.experts ?? []).flatMap((expert) => expert.tools ?? []);
      const decisions = listDecisions({ runId: run.id });
      return {
        id: run.id,
        goal: run.goal,
        createdAt: run.createdAt,
        status: run.status,
        experts: (run.plan?.experts ?? []).map((expert) => expert.id),
        latencyMs: run.latencyMs ?? null,
        operationCount: run.operations?.length ?? 0,
        decisionCount: decisions.length,
        pendingDecisionCount: decisions.filter((decision) => decision.status === "pending").length,
        undoneCount: (run.operations ?? []).filter((operation) => operation.undone).length,
        memoryCount: run.memories?.length ?? 0,
        toolCallCount: tools.length,
        toolFailureCount: tools.filter((tool) => !tool.ok).length,
        badcase: run.badcase ? { ...run.badcase, source: run.badcase.source ?? "pm" } : null,
        intent: run.plan?.intent ?? "",
      };
    });
}

export function getRun(id) {
  return read().runs.find((run) => run.id === id) ?? null;
}

export function tagRun(id, badcase) {
  const state = read();
  const run = state.runs.find((item) => item.id === id);
  if (!run) return null;
  run.badcase = badcase
    ? {
        category: String(badcase.category ?? "其他").slice(0, 40),
        note: String(badcase.note ?? "").slice(0, 600),
        source: badcase.source === "user" ? "user" : "pm",
        at: Date.now(),
      }
    : null;
  write(state);
  return run;
}
