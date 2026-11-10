import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "memory.json");

const STOP_WORDS = new Set(["的", "了", "是", "和", "在", "我", "把", "给", "帮", "请", "一下", "怎么", "如何"]);

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function readState() {
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.entries)) return parsed;
  } catch {
    /* first run */
  }
  return { entries: [] };
}

function writeState(state) {
  ensureDir();
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function tokens(text) {
  const words = String(text)
    .toLowerCase()
    .split(/[\s，。；、,.!?！？:：()（）\[\]【】“”"'’]+/)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
  const chars = String(text).replace(/\s/g, "").split("");
  const bigrams = [];
  for (let i = 0; i < chars.length - 1; i += 1) bigrams.push(chars[i] + chars[i + 1]);
  return new Set([...words, ...bigrams]);
}

export function listMemory({ kind, status, scope, limit = 50 } = {}) {
  const state = readState();
  return state.entries
    .filter((entry) => (!kind || entry.kind === kind) && (!status || entry.status === status) && (!scope || entry.scope === scope))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export function memoryStats() {
  const entries = readState().entries;
  const verified = entries.filter((entry) => entry.status === "verified");
  const correct = verified.filter((entry) => entry.verdict === "correct").length;
  return {
    total: entries.length,
    pending: entries.filter((entry) => entry.status === "pending").length,
    verified: verified.length,
    preferences: entries.filter((entry) => entry.kind === "preference").length,
    accuracy: verified.length ? Math.round((correct / verified.length) * 100) : null,
  };
}

/** 记忆检索：关键词 + 作用域 + 时间衰减 + 已验证加权 */
export function retrieveMemory({ text = "", accountId = null, category = null, org = null, limit = 6 } = {}) {
  const entries = readState().entries;
  if (!entries.length) return [];
  const queryTokens = tokens(text);
  const now = Date.now();
  const scored = entries.map((entry) => {
    const docTokens = tokens(`${entry.text} ${(entry.tags ?? []).join(" ")} ${entry.goal ?? ""}`);
    let overlap = 0;
    for (const token of queryTokens) if (docTokens.has(token)) overlap += 1;
    const keywordScore = Math.min(8, overlap * 1.6);
    const scopeScore =
      (entry.scope_ref?.account_id && entry.scope_ref.account_id === accountId ? 3 : 0) +
      (entry.scope_ref?.category && entry.scope_ref.category === category ? 2 : 0) +
      (entry.scope_ref?.org && entry.scope_ref.org === org ? 1.5 : 0);
    const ageDays = Math.max(0, (now - entry.created_at) / 86400000);
    const recency = Math.max(0, 2.5 - ageDays * 0.12);
    const verifiedBonus = entry.status === "verified" ? (entry.verdict === "correct" ? 2.2 : entry.verdict === "wrong" ? -1 : 0.8) : 0;
    const kindBonus = entry.kind === "preference" ? 1.4 : entry.kind === "outcome" ? 0.8 : 0.5;
    return { entry, score: keywordScore + scopeScore + recency + verifiedBonus + kindBonus };
  });
  return scored
    .filter((item) => item.score > 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({ ...item.entry, score: Math.round(item.score * 10) / 10 }));
}

export function addMemory(entries) {
  const state = readState();
  const created = [];
  for (const entry of entries) {
    const now = Date.now();
    const text = String(entry.text ?? "").slice(0, 600);
    const duplicate = state.entries.find((item) => item.kind === (entry.kind ?? "decision") && item.text === text);
    if (duplicate) {
      duplicate.created_at = now;
      duplicate.run_id = entry.run_id ?? duplicate.run_id;
      duplicate.goal = String(entry.goal ?? duplicate.goal ?? "").slice(0, 300);
      created.push(duplicate);
      continue;
    }
    const record = {
      id: uid("mem"),
      kind: entry.kind ?? "decision",
      scope: entry.scope ?? "global",
      scope_ref: entry.scope_ref ?? {},
      text,
      tags: (entry.tags ?? []).slice(0, 8),
      evidence: String(entry.evidence ?? "").slice(0, 500),
      goal: String(entry.goal ?? "").slice(0, 300),
      run_id: entry.run_id ?? null,
      created_at: now,
      status: "pending",
      expected: entry.expected ?? null,
      actual: null,
      verify_after: now + 3 * 86400000,
      verdict: null,
      source: entry.source ?? "partner",
    };
    state.entries.push(record);
    created.push(record);
  }
  writeState(state);
  return created;
}

function simulateActual(entry) {
  const expected = entry.expected;
  if (!expected || expected.value === undefined || expected.value === null) {
    return { text: "模拟回看：方向符合预期，具体幅度待更多周期数据", numeric: null };
  }
  let hash = 0;
  for (const char of `${entry.id}${entry.text}`) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const factor = 0.86 + (hash % 240) / 1000; // 0.86 ~ 1.10
  const value = Math.round(expected.value * factor * 100) / 100;
  return {
    text: `模拟回看：${expected.label ?? "目标指标"} 实际为 ${value}${expected.unit ?? ""}`,
    numeric: value,
    factor,
  };
}

export function verifyMemory(id) {
  const state = readState();
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return { ok: false, error: "记忆不存在" };
  if (entry.status === "verified") return { ok: true, entry };

  const actual = simulateActual(entry);
  const expectedValue = entry.expected?.value;
  let verdict = "partial";
  if (typeof expectedValue === "number" && actual.numeric !== null) {
    const ratio = actual.numeric / expectedValue;
    verdict = ratio >= 0.95 ? "correct" : ratio >= 0.85 ? "partial" : "wrong";
  } else {
    verdict = "partial";
  }
  entry.status = "verified";
  entry.actual = {
    text: actual.text,
    value: actual.numeric,
    verified_at: Date.now(),
    simulated: true,
  };
  entry.verdict = verdict;
  writeState(state);
  return { ok: true, entry };
}

export function memoryPromptBlock(entries) {
  if (!entries.length) return "（暂无相关记忆）";
  return entries
    .map(
      (entry) =>
        `- [${entry.kind === "preference" ? "偏好" : entry.kind === "outcome" ? "已验证结果" : "历史决策"}] ${entry.text}${
          entry.kind === "outcome" && entry.actual?.text ? `（${entry.actual.text}）` : ""
        }`,
    )
    .join("\n");
}
