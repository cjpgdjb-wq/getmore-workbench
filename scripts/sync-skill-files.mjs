/**
 * 把内置技能导出为 WorkBuddy 风格的目录包：
 *   agent/skills/<id>/SKILL.md   # 方法正文（给模型看）
 *   agent/skills/<id>/skill.json # 结构化元数据（专家绑定、工具、输出、失败处理）
 *
 * 用法：node scripts/sync-skill-files.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILLS } from "../server/skills.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(ROOT, "agent", "skills");

function yamlList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function renderSkillMarkdown(skill) {
  const lines = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    `version: ${JSON.stringify(skill.version)}`,
    `expertIds: ${yamlList(skill.expertIds ?? [])}`,
    `triggers: ${yamlList(skill.trigger ?? [])}`,
    `toolNames: ${yamlList(skill.toolNames ?? [])}`,
    "---",
    "",
    `# ${skill.name}`,
    "",
    skill.description,
    "",
    "## 什么时候用",
    "",
    ...(skill.trigger ?? []).map((item) => `- ${item}`),
    "",
    "## 业务问题",
    "",
    skill.businessProblem,
    "",
    "## 方法",
    "",
    skill.designRationale,
    "",
    "## 步骤",
    "",
    ...(skill.steps ?? []).map((step, index) => `${index + 1}. ${step}`),
    "",
    "## 输出",
    "",
    "```json",
    JSON.stringify(skill.output ?? {}, null, 2),
    "```",
    "",
    "## 护栏",
    "",
    ...((skill.output?.guardrail ?? []).map((item) => `- ${item}`)),
    "",
    "## 失败处理",
    "",
    skill.failure,
    "",
    "## 使用边界",
    "",
    "- 技能只提供方法与判断顺序，不直接执行动作；动作由工具提交，写操作必须人工确认。",
    "- 没有工具返回的数字，不要编造；缺数据时按失败处理执行。",
    "",
  ];
  return lines.join("\n");
}

fs.mkdirSync(SKILLS_DIR, { recursive: true });
for (const skill of DEFAULT_SKILLS) {
  const dir = path.join(SKILLS_DIR, skill.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), renderSkillMarkdown(skill), "utf8");
  const metadata = {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    expertIds: skill.expertIds,
    toolNames: skill.toolNames,
    triggers: skill.trigger,
    steps: skill.steps,
    output: skill.output,
    failure: skill.failure,
    businessProblem: skill.businessProblem,
    designRationale: skill.designRationale,
    businessMetrics: skill.businessMetrics,
    closedLoop: skill.closedLoop,
    evidence: skill.evidence,
    evalCaseFile: skill.evalCaseFile,
    doc: "SKILL.md",
  };
  fs.writeFileSync(path.join(dir, "skill.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`skill -> agent/skills/${skill.id}/`);
}
