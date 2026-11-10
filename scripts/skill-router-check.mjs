import assert from "node:assert/strict";
import { routeSkill } from "../server/skill-router.mjs";
import { skillPromptBlock } from "../server/skills.mjs";

const cases = [
  ["诊断学习期计划还要不要降预算", "learning_phase_diagnosis"],
  ["把低 ROI 的预算挪到高 ROI 账户", "budget_reallocation"],
  ["库存只剩 3 天，计划还要不要投", "inventory_stop_loss"],
  ["退款率 22%，要不要降预算", "refund_anomaly"],
  ["素材被拒审，计划还在消耗", "creative_reject_guard"],
  ["写本周投放周报", "weekly_review"],
  ["今天天气怎么样", null],
];

for (const [goal, expected] of cases) {
  const route = routeSkill(goal);
  assert.equal(route.skill?.id ?? null, expected, `${goal} -> ${expected}, got ${route.skill?.id ?? "none"}`);
  console.log(`${route.skill?.id ?? "none"} <- ${goal}`);
}

const weeklyPrompt = skillPromptBlock("analytics", ["weekly_review"]);
assert.ok(weeklyPrompt.includes("周报复盘"));
assert.ok(!weeklyPrompt.includes("学习期诊断"));
assert.equal(skillPromptBlock("ads", ["weekly_review"]), "");

const learningPrompt = skillPromptBlock("analytics", ["learning_phase_diagnosis"]);
assert.ok(learningPrompt.includes("学习期诊断"));
assert.ok(!learningPrompt.includes("退款异常诊断"));

console.log("Skill router check passed");
