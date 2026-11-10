/**
 * 校验专家包：
 * - agent/experts/<id>.json 三个专家；
 * - 人设/技能/连接器都有；
 * - skillIds 与技能 expertIds 一致；
 * - connectorIds 与 expert.tools 一致。
 */
import assert from "node:assert/strict";
import { listExpertConfigs } from "../server/experts.mjs";
import { EXPERTS } from "../server/tools.mjs";
import { listSkills } from "../server/skills.mjs";
import { listConnectors } from "../server/connectors.mjs";

const configs = listExpertConfigs();
assert.equal(configs.length, 3, "应该有 3 个专家包");
const skills = listSkills();
const connectors = listConnectors();
assert.equal(EXPERTS.length, 3, "运行时专家数不对");

for (const config of configs) {
  assert.ok(config.persona.length > 5, `${config.id} 缺少人设`);
  assert.ok(Array.isArray(config.skillIds), `${config.id} 缺少 skillIds`);
  assert.ok(Array.isArray(config.connectorIds), `${config.id} 缺少 connectorIds`);
  const runtime = EXPERTS.find((expert) => expert.id === config.id);
  assert.ok(runtime, `${config.id} 运行时不存`);
  assert.deepEqual(
    runtime.tools.map((tool) => tool.name).sort(),
    config.connectorIds.slice().sort(),
    `${config.id} connectorIds 与工具不一致`,
  );
  for (const skillId of config.skillIds) {
    const skill = skills.find((item) => item.id === skillId);
    assert.ok(skill, `${config.id} 绑定了不存在的技能 ${skillId}`);
    assert.ok((skill.expertIds ?? []).includes(config.id), `${config.id} 无权使用技能 ${skillId}`);
  }
  for (const connectorId of config.connectorIds) {
    const connector = connectors.find((item) => item.id === connectorId);
    assert.ok(connector, `${config.id} 绑定了不存在的连接器 ${connectorId}`);
    assert.ok(connector.expertIds.includes(config.id), `${config.id} 无权使用连接器 ${connectorId}`);
  }
}

assert.deepEqual(
  configs.find((config) => config.id === "opportunity").skillIds,
  [],
  "机会洞察不应绑定技能",
);
assert.equal(configs.find((config) => config.id === "analytics").skillIds.length, 6, "数据分析应绑定 6 个技能");
assert.equal(configs.find((config) => config.id === "ads").skillIds.length, 5, "广告投放应绑定 5 个技能");

console.log(`experts: ${configs.length} | ${configs.map((config) => `${config.id}:${config.connectorIds.length} connectors/${config.skillIds.length} skills`).join(" | ")}`);
console.log("expert config check passed");
