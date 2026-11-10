import http from "node:http";
import { hasProvider, provider } from "./llm.mjs";
import { getOperation, operationsView, undoOperation, EXECUTION_GUARDRAILS } from "./operations.mjs";
import { approveDecision, getDecision, listDecisions, rejectDecision, DECISION_TTL_MS } from "./decisions.mjs";
import { listMemory, memoryStats, verifyMemory } from "./memory.mjs";
import { getRun, listRuns, tagRun } from "./runs.mjs";
import { toolCatalog } from "./tools.mjs";
import { connectorById, listConnectors } from "./connectors.mjs";
import { runPartner } from "./orchestrator.mjs";
import { proposeWorkspaceActions } from "./workspace-proposals.mjs";
import { getHypothesisLibrary, replayHypothesis } from "./hypotheses.mjs";
import {
  dismissRecommendation,
  getExperimentLibrary,
  getRecommendations,
  readoutExperiment,
  rollbackExperiment,
  startExperiment,
  stopExperiment,
} from "./experiments.mjs";
import { getExperimentUsage, recordExperimentEvent } from "./experiment-events.mjs";
import { deleteSkill, listSkills, saveSkill, skillById } from "./skills.mjs";
import {
  deleteImportedTool,
  getTool,
  importToolDefinition,
  listTools,
  saveTool,
} from "./tool-registry.mjs";

const PORT = Number(process.env.PARTNER_PORT || 5180);
const HOST = process.env.PARTNER_HOST || "127.0.0.1";
const MAX_BODY = 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function trackExperiment(payload) {
  try {
    recordExperimentEvent(payload);
  } catch {
    // 埋点失败不影响主流程
  }
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("JSON 解析失败"));
      }
    });
    req.on("error", reject);
  });
}

function openSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
  res.flushHeaders?.();
  let closed = false;
  const ping = setInterval(() => {
    if (!closed) res.write(": ping\n\n");
  }, 15000);
  res.on("close", () => {
    closed = true;
    clearInterval(ping);
  });
  return {
    send(event) {
      if (closed) return;
      try {
        res.write(`event: ${event.type ?? "message"}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        closed = true;
      }
    },
    end() {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      try {
        res.write("event: done\ndata: {}\n\n");
        res.end();
      } catch {
        /* ignore */
      }
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && path === "/partner/health") {
      return sendJson(res, 200, {
        ok: true,
        model: provider.model,
        provider_ready: hasProvider(),
        memory: memoryStats(),
        guardrails: EXECUTION_GUARDRAILS,
        decisions: {
          pending: listDecisions({ status: "pending" }).length,
          ttl_minutes: DECISION_TTL_MS / 60000,
        },
        experts: toolCatalog().map((expert) => ({
          id: expert.id,
          name: expert.name,
          role: expert.role,
          tools: expert.tools.length,
          canWrite: expert.canWrite,
        })),
      });
    }

    if (req.method === "GET" && path === "/partner/experts") {
      return sendJson(res, 200, { experts: toolCatalog(), guardrails: EXECUTION_GUARDRAILS });
    }

    if (req.method === "GET" && path === "/partner/hypotheses") {
      const library = await getHypothesisLibrary();
      return sendJson(res, 200, library);
    }

    const hypothesisReplayMatch = path.match(/^\/partner\/hypotheses\/([^/]+)\/replay$/);
    if (hypothesisReplayMatch && req.method === "POST") {
      const result = await replayHypothesis(decodeURIComponent(hypothesisReplayMatch[1]));
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && path === "/partner/skills") {
      return sendJson(res, 200, { skills: listSkills() });
    }

    const skillMatch = path.match(/^\/partner\/skills\/([^/]+)$/);
    if (req.method === "GET" && skillMatch) {
      const skill = skillById(decodeURIComponent(skillMatch[1]));
      return skill ? sendJson(res, 200, { skill }) : sendJson(res, 404, { error: "技能不存在" });
    }
    if (req.method === "PUT" && skillMatch) {
      try {
        const body = await readJson(req);
        const skill = saveSkill({ ...body, id: decodeURIComponent(skillMatch[1]) });
        return sendJson(res, 200, { ok: true, skill });
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "保存技能失败" });
      }
    }
    if (req.method === "DELETE" && skillMatch) {
      try {
        return sendJson(res, 200, deleteSkill(decodeURIComponent(skillMatch[1])));
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "删除技能失败" });
      }
    }
    if (req.method === "POST" && path === "/partner/skills") {
      try {
        const body = await readJson(req);
        const skill = saveSkill(body);
        return sendJson(res, 200, { ok: true, skill });
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "导入技能失败" });
      }
    }

    if (req.method === "GET" && path === "/partner/tools") {
      return sendJson(res, 200, { tools: listTools() });
    }

    if (req.method === "GET" && path === "/partner/connectors") {
      return sendJson(res, 200, { connectors: listConnectors() });
    }

    const connectorMatch = path.match(/^\/partner\/connectors\/([^/]+)$/);
    if (req.method === "GET" && connectorMatch) {
      const connector = connectorById(decodeURIComponent(connectorMatch[1]));
      return connector ? sendJson(res, 200, { connector }) : sendJson(res, 404, { error: "连接器不存在" });
    }

    const toolMatch = path.match(/^\/partner\/tools\/([^/]+)$/);
    if (req.method === "GET" && toolMatch) {
      const tool = getTool(decodeURIComponent(toolMatch[1]));
      return tool ? sendJson(res, 200, { tool }) : sendJson(res, 404, { error: "工具不存在" });
    }
    if (req.method === "PUT" && toolMatch) {
      try {
        const body = await readJson(req);
        const tool = saveTool(decodeURIComponent(toolMatch[1]), {
          description: body.description,
          enabled: body.enabled,
        });
        return sendJson(res, 200, { ok: true, tool });
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "保存工具失败" });
      }
    }
    if (req.method === "DELETE" && toolMatch) {
      try {
        return sendJson(res, 200, deleteImportedTool(decodeURIComponent(toolMatch[1])));
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "删除工具失败" });
      }
    }
    if (req.method === "POST" && path === "/partner/tools/import") {
      try {
        const body = await readJson(req);
        const tool = importToolDefinition(body);
        return sendJson(res, 200, { ok: true, tool });
      } catch (error) {
        return sendJson(res, 400, { error: error instanceof Error ? error.message : "导入工具失败" });
      }
    }

    if (req.method === "GET" && path === "/partner/experiments/recommendations") {
      const result = await getRecommendations({
        accountId: url.searchParams.get("accountId") ?? null,
        planId: url.searchParams.get("planId") ?? null,
        asOf: url.searchParams.get("asOf") ?? null,
        policy: url.searchParams.get("policy") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 3),
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && path === "/partner/experiments/usage") {
      return sendJson(res, 200, getExperimentUsage());
    }

    if (req.method === "POST" && path === "/partner/experiments/view") {
      const body = await readJson(req);
      trackExperiment({ type: "view", count: Number(body.count ?? 0), source: String(body.source ?? "") || null });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/partner/experiments") {
      const result = await getExperimentLibrary({
        accountId: url.searchParams.get("accountId") ?? null,
        planId: url.searchParams.get("planId") ?? null,
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && path === "/partner/experiments") {
      const body = await readJson(req);
      const result = await startExperiment({
        recommendationId: String(body.recommendationId ?? ""),
        mode: body.mode === "observe" ? "observe" : "start",
      });
      if (result.ok) {
        trackExperiment({
          type: result.experiment.mode === "observe" ? "start_observe" : "start_action",
          experimentId: result.experiment.id,
          recommendationId: result.experiment.recommendationId,
          templateId: result.experiment.templateId,
          mode: result.experiment.mode,
        });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "POST" && path === "/partner/experiments/dismiss") {
      const body = await readJson(req);
      const result = await dismissRecommendation(String(body.recommendationId ?? ""));
      if (result.ok) {
        trackExperiment({ type: "dismiss", recommendationId: String(body.recommendationId ?? "") });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    const experimentReadoutMatch = path.match(/^\/partner\/experiments\/([^/]+)\/readout$/);
    if (experimentReadoutMatch && req.method === "POST") {
      const result = await readoutExperiment(decodeURIComponent(experimentReadoutMatch[1]));
      if (result.ok) {
        trackExperiment({
          type: "readout",
          experimentId: result.experiment.id,
          templateId: result.experiment.templateId,
          mode: result.experiment.mode,
        });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    const experimentStopMatch = path.match(/^\/partner\/experiments\/([^/]+)\/stop$/);
    if (experimentStopMatch && req.method === "POST") {
      const body = await readJson(req);
      const result = await stopExperiment(decodeURIComponent(experimentStopMatch[1]), {
        rollback: Boolean(body.rollback),
      });
      if (result.ok && result.experiment) {
        trackExperiment({
          type: result.experiment.status === "reverted" ? "rollback" : "cancel",
          experimentId: result.experiment.id,
          templateId: result.experiment.templateId,
          mode: result.experiment.mode,
        });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    const experimentRollbackMatch = path.match(/^\/partner\/experiments\/([^/]+)\/rollback$/);
    if (experimentRollbackMatch && req.method === "POST") {
      const result = await rollbackExperiment(decodeURIComponent(experimentRollbackMatch[1]));
      if (result.ok && result.experiment) {
        trackExperiment({
          type: "rollback",
          experimentId: result.experiment.id,
          templateId: result.experiment.templateId,
          mode: result.experiment.mode,
        });
      }
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && path === "/partner/memory") {
      const kind = url.searchParams.get("kind") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      return sendJson(res, 200, {
        stats: memoryStats(),
        entries: listMemory({ kind, status, limit: 30 }),
      });
    }

    if (req.method === "POST" && path === "/partner/memory/verify") {
      const body = await readJson(req);
      if (!body.id) return sendJson(res, 400, { error: "缺少记忆 id" });
      const result = verifyMemory(body.id);
      return sendJson(res, result.ok ? 200 : 404, result);
    }

    if (req.method === "GET" && path === "/partner/runs") {
      return sendJson(res, 200, { runs: listRuns(12) });
    }

    const badcaseMatch = path.match(/^\/partner\/runs\/([^/]+)\/badcase$/);
    if (badcaseMatch && req.method === "POST") {
      const body = await readJson(req);
      const categories = ["结论错误", "动作错误", "工具失败", "上下文缺失", "编造事实", "延迟过高", "其他"];
      const category = categories.includes(body.category) ? body.category : "其他";
      const run = tagRun(badcaseMatch[1], {
        category,
        note: body.note ?? "",
        source: body.source === "user" ? "user" : "pm",
      });
      if (!run) return sendJson(res, 404, { error: "任务不存在" });
      return sendJson(res, 200, { ok: true, id: run.id, badcase: run.badcase });
    }

    if (badcaseMatch && req.method === "DELETE") {
      const run = tagRun(badcaseMatch[1], null);
      if (!run) return sendJson(res, 404, { error: "任务不存在" });
      return sendJson(res, 200, { ok: true, id: run.id, badcase: null });
    }

    if (req.method === "GET" && path.startsWith("/partner/runs/")) {
      const id = path.slice("/partner/runs/".length);
      const run = getRun(id);
      if (run?.operations) {
        run.operations = run.operations.map((operation) => getOperation(operation.id) ?? operation);
      }
      return sendJson(res, run ? 200 : 404, run ? { run } : { error: "任务不存在" });
    }

    if (req.method === "GET" && path === "/partner/decisions") {
      const runId = url.searchParams.get("runId") ?? undefined;
      const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
      const status = url.searchParams.get("status") ?? undefined;
      return sendJson(res, 200, {
        decisions: listDecisions({ runId, workspaceId, status, limit: 80 }),
        ttlMinutes: DECISION_TTL_MS / 60000,
      });
    }

    const decisionApproveMatch = path.match(/^\/partner\/decisions\/([^/]+)\/approve$/);
    if (decisionApproveMatch && req.method === "POST") {
      const body = await readJson(req);
      const result = approveDecision(decisionApproveMatch[1], {
        comment: String(body.comment ?? ""),
        by: String(body.by ?? "优化师"),
      });
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    const decisionRejectMatch = path.match(/^\/partner\/decisions\/([^/]+)\/reject$/);
    if (decisionRejectMatch && req.method === "POST") {
      const body = await readJson(req);
      const result = rejectDecision(decisionRejectMatch[1], {
        comment: String(body.comment ?? ""),
        by: String(body.by ?? "优化师"),
      });
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    const decisionMatch = path.match(/^\/partner\/decisions\/([^/]+)$/);
    if (decisionMatch && req.method === "GET") {
      const decision = getDecision(decisionMatch[1]);
      return sendJson(res, decision ? 200 : 404, decision ? { decision } : { error: "待确认动作不存在" });
    }

    if (req.method === "POST" && path === "/partner/workspace/propose") {
      if (!hasProvider()) return sendJson(res, 503, { error: "模型 API Key 未配置" });
      const body = await readJson(req);
      const productId = String(body.productId ?? "").trim();
      const workspaceId = String(body.workspaceId ?? "").trim();
      const message = String(body.message ?? "").trim();
      if (!productId || !workspaceId || message.length < 2) {
        return sendJson(res, 400, { error: "缺少商品工作区或用户消息" });
      }
      if (message.length > 800) return sendJson(res, 400, { error: "用户消息过长" });
      const result = await proposeWorkspaceActions({
        productId,
        workspaceId,
        runId: String(body.runId ?? `workspace_${workspaceId}_${Date.now().toString(36)}`),
        message,
        assistantText: String(body.assistantText ?? "").slice(0, 3000),
        permission: body.permission === "read" ? "read" : "suggest",
        toolIds: Array.isArray(body.toolIds) ? body.toolIds.map(String).slice(0, 30) : [],
      });
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "GET" && path === "/partner/operations") {
      const runId = url.searchParams.get("runId") ?? undefined;
      const includeUndone = url.searchParams.get("includeUndone") === "1";
      return sendJson(res, 200, {
        operations: operationsView().filter(
          (operation) => (!runId || operation.run_id === runId) && (includeUndone || !operation.undone),
        ),
        guardrails: EXECUTION_GUARDRAILS,
      });
    }

    if (req.method === "POST" && path.startsWith("/partner/operations/") && path.endsWith("/undo")) {
      const id = path.slice("/partner/operations/".length, -"/undo".length);
      const result = undoOperation(id);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "POST" && path === "/partner/run") {
      const body = await readJson(req);
      const goal = String(body.goal ?? "").trim();
      if (goal.length < 4) return sendJson(res, 400, { error: "请描述更完整的经营目标" });
      if (goal.length > 600) return sendJson(res, 400, { error: "目标描述过长" });
      if (!hasProvider()) {
        return sendJson(res, 503, { error: "模型 API Key 未配置" });
      }

      const sse = openSse(res);
      const controller = new AbortController();
      req.on("close", () => controller.abort());
      try {
        await runPartner({
          goal,
          view: body.view ?? {},
          emit: (event) => sse.send(event),
          signal: controller.signal,
        });
      } catch (error) {
        sse.send({ type: "error", message: error instanceof Error ? error.message : "任务执行失败" });
      } finally {
        sse.end();
      }
      return;
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (!res.headersSent) {
      return sendJson(res, 500, { error: error instanceof Error ? error.message : "服务器错误" });
    }
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[partner] orchestrator listening on http://${HOST}:${PORT}`);
  console.log(`[partner] provider: ${provider.model} · key ${hasProvider() ? "ready" : "missing"}`);
});
