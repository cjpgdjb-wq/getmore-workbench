/**
 * Tool Registry：工具目录（查看 / 导入定义 / 编辑元数据）。
 *
 * 重要边界：工具定义可以导入，但执行代码必须在 tools.mjs 注册 handler。
 * 没有 handler 的导入工具会显示 executable=false，专家不会自动获得它。
 */

import fs from "node:fs";
import path from "node:path";
import { toolCatalog } from "./tools.mjs";

const STORE = path.join(process.cwd(), ".runtime", "partner", "tools.json");

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return {
      overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
      imported: Array.isArray(parsed.imported) ? parsed.imported : [],
    };
  } catch {
    return { overrides: {}, imported: [] };
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2), "utf8");
}

function riskOf(tool) {
  if (tool.name === "pause_plan") return "destructive";
  return tool.canWrite ? "write" : "read";
}

export function defaultTools() {
  const map = new Map();
  for (const expert of toolCatalog()) {
    for (const tool of expert.tools) {
      const id = tool.name;
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: tool.name,
          description: tool.description,
          expertIds: [],
          expertNames: [],
          parameters: tool.parameters,
          canWrite: expert.canWrite,
          risk: riskOf({ ...tool, canWrite: expert.canWrite }),
          handlerId: tool.name,
          source: "code",
          executable: true,
          enabled: true,
        });
      }
      const item = map.get(id);
      if (!item.expertIds.includes(expert.id)) item.expertIds.push(expert.id);
      if (!item.expertNames.includes(expert.name)) item.expertNames.push(expert.name);
    }
  }
  return [...map.values()];
}

export function listTools() {
  const store = readStore();
  const codeTools = defaultTools().map((tool) => {
    const override = store.overrides[tool.id] ?? {};
    return {
      ...tool,
      description: typeof override.description === "string" ? override.description : tool.description,
      enabled: typeof override.enabled === "boolean" ? override.enabled : tool.enabled,
    };
  });
  return [
    ...codeTools,
    ...store.imported.map((tool) => ({
      ...tool,
      source: "imported",
      executable: false,
      handlerId: null,
    })),
  ];
}

export function getTool(id) {
  return listTools().find((tool) => tool.id === id) ?? null;
}

export function saveTool(id, patch = {}) {
  const tool = getTool(id);
  if (!tool) throw new Error("工具不存在");
  if (tool.source === "code") {
    const store = readStore();
    const current = store.overrides[id] ?? {};
    store.overrides[id] = {
      ...current,
      ...(typeof patch.description === "string" ? { description: patch.description } : {}),
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    };
    writeStore(store);
    return getTool(id);
  }
  const store = readStore();
  const index = store.imported.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("导入工具不存在");
  store.imported[index] = {
    ...store.imported[index],
    ...(typeof patch.description === "string" ? { description: patch.description } : {}),
  };
  writeStore(store);
  return getTool(id);
}

export function importToolDefinition(input) {
  const name = String(input?.name ?? "").trim();
  if (!name) throw new Error("工具需要 name");
  if (defaultTools().some((tool) => tool.id === name || tool.name === name)) {
    throw new Error("已存在同名代码工具，不能导入覆盖");
  }
  const store = readStore();
  if (store.imported.some((tool) => tool.id === name)) throw new Error("已存在同名导入工具");
  const expertIds = Array.isArray(input.expertIds) ? input.expertIds.map(String) : [];
  const tool = {
    id: name,
    name,
    description: String(input.description ?? ""),
    expertIds,
    expertNames: [],
    parameters: input.parameters && typeof input.parameters === "object" ? input.parameters : { type: "object", properties: {} },
    canWrite: false,
    risk: "read",
    handlerId: null,
    source: "imported",
    executable: false,
    enabled: false,
    importedAt: Date.now(),
  };
  store.imported.push(tool);
  writeStore(store);
  return tool;
}

export function deleteImportedTool(id) {
  const store = readStore();
  const next = store.imported.filter((tool) => tool.id !== id);
  if (next.length === store.imported.length) throw new Error("只能删除导入的工具");
  store.imported = next;
  writeStore(store);
  return { ok: true };
}
