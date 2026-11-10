/**
 * 本地 MCP Server（stdio JSON-RPC）。
 *
 * 把 GETmore 的业务 connector 暴露成 MCP tools：
 * - initialize / tools/list / tools/call
 * - 工具执行仍走 executeTool()；下一步可替换成真实千川 API
 *
 * MCP 的 stdio 传输使用“一行一个 JSON-RPC 消息”，不要输出任何日志到 stdout；
 * 调试日志统一写 stderr。
 */
import readline from "node:readline";
import { loadMock } from "./mock.mjs";
import { decorateMock } from "./operations.mjs";
import { EXPERTS, executeTool } from "./tools.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const baseMock = await loadMock();

const toolMap = new Map();
for (const expert of EXPERTS) {
  for (const tool of expert.tools) {
    if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
  }
}
const tools = [...toolMap.values()].map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.parameters,
}));

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function contextFromMeta(meta = {}) {
  return {
    runId: meta.runId ?? `mcp_${Date.now().toString(36)}`,
    mock: decorateMock(baseMock),
    baseMock,
    range: meta.range ?? {
      start: baseMock.DATE_KEYS[baseMock.DATE_KEYS.length - 7],
      end: baseMock.DATE_KEYS[baseMock.DATE_KEYS.length - 1],
    },
    channel: meta.channel ?? "auction",
    accountId: meta.accountId ?? null,
    requestedTargets: meta.requestedTargets ?? { accountIds: [], planIds: [], invalid: false },
    expectsAction: Boolean(meta.expectsAction),
    writeBlocked: Boolean(meta.writeBlocked),
    emit: () => {},
  };
}

async function callTool(params) {
  const name = String(params?.name ?? "");
  if (!toolMap.has(name)) {
    return { isError: true, content: [{ type: "text", text: `未知工具：${name}` }] };
  }
  const meta = params?._meta ?? {};
  const expertId = String(meta.expertId ?? "ads");
  try {
    const result = await executeTool(expertId, name, params?.arguments ?? {}, contextFromMeta(meta));
    return {
      isError: !result.ok,
      structuredContent: result,
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : "工具执行失败" }],
    };
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const text = String(line ?? "").trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    process.stderr.write(`[mcp] 无效 JSON：${text.slice(0, 120)}\n`);
    return;
  }
  if (message.method === "initialize") {
    return reply(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "getmore-connectors", version: "0.1.0" },
    });
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") return reply(message.id, { tools });
  if (message.method === "tools/call") {
    try {
      return reply(message.id, await callTool(message.params ?? {}));
    } catch (error) {
      return reply(message.id, {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : "工具执行失败" }],
      });
    }
  }
  if (message.method === "ping") return reply(message.id, {});
  if (message.id !== undefined) fail(message.id, -32601, `不支持的方法：${message.method}`);
});
rl.on("close", () => process.exit(0));
process.stderr.write(`[mcp] getmore connector server ready: ${tools.length} tools\n`);
