/**
 * 本地 MCP client：spawn server/mcp-server.mjs，用 stdio JSON-RPC 调工具。
 * 失败时由 connectors.mjs 回退到进程内 executeTool（演示/受限环境）。
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server", "mcp-server.mjs");
const DEBUG = process.env.MCP_DEBUG === "1";

let singleton = null;
let disabled = false;

function createClient() {
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, MCP_MODE: "off" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  // 不让 MCP 子进程拖住父进程退出（CLI/评测脚本跑完即可结束）。
  child.unref();
  child.stdin.unref?.();
  child.stdout.unref?.();
  child.stderr.unref?.();
  process.once("exit", () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  });
  let nextId = 0;
  let buffer = "";
  const pending = new Map();

  const rejectAll = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };

  const send = (payload) => {
    if (!child.stdin.writable) throw new Error("MCP stdin 不可写");
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        if (DEBUG) process.stderr.write(`[mcp-client] 无法解析：${text.slice(0, 120)}\n`);
        continue;
      }
      if (message.id === undefined) continue;
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message ?? "MCP 请求失败"));
      else item.resolve(message.result);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (DEBUG) process.stderr.write(`[mcp-server] ${chunk}`);
  });
  child.on("error", (error) => {
    disabled = true;
    singleton = null;
    rejectAll(error);
  });
  child.on("exit", (code) => {
    rejectAll(new Error(`MCP server 退出：${code ?? "unknown"}`));
    singleton = null;
  });

  const request = (method, params, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });

  let initPromise = null;
  const ensureInit = () => {
    if (!initPromise) {
      initPromise = request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "getmore-orchestrator", version: "0.1.0" },
      }).then(() => {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
      });
    }
    return initPromise;
  };

  const callTool = async (name, args, meta) => {
    await ensureInit();
    const result = await request("tools/call", { name, arguments: args ?? {}, _meta: meta ?? {} }, 45000);
    if (result?.structuredContent) return result.structuredContent;
    const text = result?.content?.find((item) => item.type === "text")?.text ?? "";
    if (result?.isError) return { ok: false, error: text || "工具执行失败" };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, result: text };
    }
  };

  return {
    callTool,
    listTools: async () => {
      await ensureInit();
      const result = await request("tools/list", {});
      return Array.isArray(result?.tools) ? result.tools : [];
    },
    close: () => {
      child.kill();
      singleton = null;
    },
  };
}

export function getMcpClient() {
  if (process.env.MCP_MODE === "off" || disabled) return null;
  if (!singleton) {
    try {
      singleton = createClient();
    } catch {
      disabled = true;
      return null;
    }
  }
  return singleton;
}
