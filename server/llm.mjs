import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, ".runtime", "nanobot-home", ".nanobot", "config.json");

function readProviderConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const deepseek = parsed?.providers?.deepseek ?? {};
    return {
      apiKey: process.env.DEEPSEEK_API_KEY || deepseek.api_key || "",
      baseUrl: process.env.DEEPSEEK_BASE_URL || deepseek.api_base || "https://api.deepseek.com",
      model:
        process.env.PARTNER_MODEL ||
        parsed?.agents?.defaults?.model ||
        "deepseek-flash",
    };
  } catch {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.PARTNER_MODEL || "deepseek-flash",
    };
  }
}

export const provider = readProviderConfig();

export function hasProvider() {
  return Boolean(provider.apiKey);
}

async function request(body, timeoutMs = 120000) {
  if (!provider.apiKey) {
    throw new Error("未配置模型 API Key：请在 .runtime/nanobot-home/.nanobot/config.json 中设置 providers.deepseek.api_key");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({ model: provider.model, ...body }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`模型请求失败 (${response.status}): ${text.slice(0, 300)}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** 非流式对话（支持 tools / JSON mode） */
export async function chat({
  messages,
  tools,
  toolChoice = "auto",
  responseFormat,
  temperature = 0.3,
  maxTokens = 1000,
}) {
  const body = {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }
  if (responseFormat) body.response_format = responseFormat;

  const response = await request(body);
  const payload = await response.json();
  const choice = payload.choices?.[0];
  if (!choice) throw new Error("模型未返回结果");
  return {
    message: choice.message ?? {},
    finishReason: choice.finish_reason,
    usage: payload.usage ?? {},
  };
}

/** 流式对话，逐段回调 delta 文本，返回完整文本与 usage */
export async function chatStream({ messages, temperature = 0.35, maxTokens = 1400, onDelta }) {
  const body = { messages, temperature, max_tokens: maxTokens, stream: true };
  const response = await request(body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = {};

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          text += delta;
          onDelta?.(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      } catch {
        /* ignore malformed keep-alive */
      }
    }
  }
  return { text, usage };
}
