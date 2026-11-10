/**
 * 校验 WorkBuddy 风格技能包：
 * - agent/skills/<id>/SKILL.md 存在；
 * - 摘要只给 name/description/trigger，正文由 load_skill 读取；
 * - 每个专家都能看到 load_skill 元工具；
 * - 专家不能加载未绑定的技能。
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { SKILLS_DIR, listSkills, loadSkillDetail, skillCatalogForPlanner, skillSummaryBlock } from "../server/skills.mjs";
import { toolSchemas } from "../server/tools.mjs";

const skills = listSkills();
assert.equal(skills.length, 6, "应该有 6 个技能");
for (const skill of skills) {
  assert.ok(skill.docPath && fs.existsSync(skill.docPath), `${skill.id} 缺少 SKILL.md`);
  assert.ok(skill.instructions.length > 20, `${skill.id} 正文为空`);
  assert.ok(typeof skill.source === "string", `${skill.id} 缺少 source`);
}
assert.deepEqual(
  skillCatalogForPlanner().map((skill) => skill.id),
  skills.map((skill) => skill.id),
  "planner 技能目录不一致",
);

const summary = skillSummaryBlock("ads", ["inventory_stop_loss"]);
assert.ok(summary.includes("load_skill"), "摘要应提示 load_skill");
assert.ok(!summary.includes("## 步骤"), "摘要不应包含完整步骤");

const detail = loadSkillDetail("inventory_stop_loss", "ads");
assert.ok(detail?.instructions.includes("## 步骤"), "load_skill 应返回完整正文");
assert.ok(detail.steps.length > 0, "load_skill 应返回步骤");
assert.equal(loadSkillDetail("inventory_stop_loss", "opportunity"), null, "机会洞察不应加载库存技能");

for (const expertId of ["opportunity", "analytics", "ads"]) {
  const names = toolSchemas(expertId).map((schema) => schema.function.name);
  assert.ok(names.includes("load_skill"), `${expertId} 缺少 load_skill`);
}

console.log(`skills: ${skills.length} | dir: ${SKILLS_DIR}`);
console.log("skill files check passed");
