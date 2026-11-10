import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deleteSkill, listSkills, saveSkill, skillById } from "../server/skills.mjs";
import { deleteImportedTool, importToolDefinition, listTools, saveTool } from "../server/tool-registry.mjs";

const SKILLS_FILE = path.join(process.cwd(), ".runtime", "partner", "skills.json");
const TOOLS_FILE = path.join(process.cwd(), ".runtime", "partner", "tools.json");
const backups = new Map(
  [SKILLS_FILE, TOOLS_FILE].map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null]),
);

try {
  const defaults = listSkills();
  assert.ok(defaults.length >= 2, "default skills");

  const original = defaults[0];
  const edited = saveSkill({ ...original, description: `${original.description}（已编辑）` });
  assert.ok(edited.description.includes("已编辑"));
  assert.ok(skillById(original.id).description.includes("已编辑"));

  const imported = saveSkill({
    ...original,
    id: "qa_skill",
    name: "QA 技能",
    version: "0.0.1",
    description: "用于测试导入",
    trigger: ["测试"],
    steps: ["一步"],
    toolNames: ["query_plans"],
    expertIds: ["analytics"],
    evalCaseFile: "",
  });
  assert.equal(imported.id, "qa_skill");
  assert.ok(listSkills().some((skill) => skill.id === "qa_skill"));
  deleteSkill("qa_skill");
  assert.ok(!skillById("qa_skill"));

  const tools = listTools();
  assert.ok(tools.length >= 15, "default tools");
  const codeTool = tools.find((tool) => tool.source === "code");
  assert.ok(codeTool, "code tool exists");
  const savedTool = saveTool(codeTool.id, { description: `${codeTool.description}（已编辑）` });
  assert.ok(savedTool.description.includes("已编辑"));

  const importedTool = importToolDefinition({
    name: "qa_http_tool",
    description: "只导入定义，不执行",
    expertIds: ["analytics"],
    parameters: { type: "object", properties: {} },
  });
  assert.equal(importedTool.executable, false);
  assert.ok(listTools().some((tool) => tool.id === "qa_http_tool" && !tool.executable));
  deleteImportedTool("qa_http_tool");
  assert.ok(!listTools().some((tool) => tool.id === "qa_http_tool"));

  console.log(`skills: ${listSkills().length} | tools: ${listTools().length}`);
  console.log("Capability check passed");
} finally {
  for (const [file, content] of backups) {
    if (content === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, content, "utf8");
    }
  }
}
