import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listSkills, skillPromptBlock, skillsForExpert } from "../server/skills.mjs";
import { expertById, toolCatalog } from "../server/tools.mjs";

const SKILLS = listSkills();
assert.ok(SKILLS.length >= 2, "should have at least 2 skills");
const catalog = toolCatalog();

for (const skill of SKILLS) {
  assert.ok(skill.id && skill.name && skill.version, "skill identity");
  assert.ok(skill.expertIds.length >= 1, `${skill.id} needs experts`);
  assert.ok(skill.toolNames.length >= 1, `${skill.id} needs tools`);
  assert.ok(skill.trigger.length >= 1, `${skill.id} needs trigger`);
  assert.ok(skill.steps.length >= 2, `${skill.id} needs steps`);
  assert.ok(skill.failure.length > 0, `${skill.id} needs failure handling`);
  assert.ok(skill.businessProblem?.length > 0, `${skill.id} needs businessProblem`);
  assert.ok(skill.designRationale?.length > 0, `${skill.id} needs designRationale`);
  assert.ok(skill.businessMetrics?.length > 0, `${skill.id} needs businessMetrics`);
  assert.ok(skill.closedLoop?.length > 0, `${skill.id} needs closedLoop`);
  assert.ok(skill.evidence?.length > 0, `${skill.id} needs evidence`);

  const boundTools = new Set();
  for (const expertId of skill.expertIds) {
    const expert = expertById(expertId);
    assert.ok(expert, `${skill.id}: expert ${expertId} exists`);
    const prompt = skillPromptBlock(expertId);
    assert.ok(prompt.includes(skill.name), `${skill.id}: prompt for ${expertId} includes skill name`);
    for (const toolName of expert.toolNames) boundTools.add(toolName);
    const expertCatalog = catalog.find((item) => item.id === expertId);
    assert.ok(expertCatalog.skills.some((item) => item.id === skill.id), `${skill.id}: catalog shows for ${expertId}`);
  }
  for (const toolName of skill.toolNames) {
    assert.ok(boundTools.has(toolName), `${skill.id}: tool ${toolName} owned by a bound expert`);
  }

  const caseFile = path.join(process.cwd(), skill.evalCaseFile);
  const payload = JSON.parse(fs.readFileSync(caseFile, "utf8"));
  assert.equal(payload.skillId, skill.id, `${skill.id}: case file skillId`);
  assert.ok(payload.cases.length >= 5, `${skill.id}: needs at least 5 cases`);
  for (const item of payload.cases) {
    assert.ok(item.id && item.name, `${skill.id}: case identity`);
    assert.ok(item.input && item.expected, `${skill.id}: case input/expected`);
    assert.ok(["observe", "reduce", "pause", "reallocate", "report"].includes(item.expected.verdict), `${skill.id}: case verdict`);
    assert.ok(
      item.expected.mustInclude.length >= 1 || item.expected.moves || item.expected.actionAny,
      `${skill.id}: case checks`,
    );
    assert.ok(item.expected.mustNotInclude.length >= 1, `${skill.id}: case mustNotInclude`);
  }

  console.log(`${skill.id} v${skill.version} | experts: ${skill.expertIds.join("+")} | cases: ${payload.cases.map((item) => item.id).join(",")}`);
}

assert.equal(skillsForExpert("opportunity").length, 0, "opportunity should not load skills");
console.log("Skill spec check passed");
