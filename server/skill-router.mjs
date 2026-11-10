/**
 * Skill Router：把“什么时候触发”从模型自觉变成可测试的规则。
 *
 * 规则只看目标文本 + 技能元数据；每个任务最多选 1 个主技能。
 * 不确定时返回空数组，让专家使用基础 prompt，而不是乱注入技能。
 */

import { skillById } from "./skills.mjs";

const RULES = [
  {
    id: "weekly_review",
    label: "周报/只读复盘",
    priority: 100,
    patterns: [/周报/, /本周复盘/, /写.*复盘/, /只读.*复盘/],
  },
  {
    id: "inventory_stop_loss",
    label: "库存/断货",
    priority: 90,
    patterns: [/库存/, /断货/, /售罄/, /没货/],
  },
  {
    id: "refund_anomaly",
    label: "退款/净成交",
    priority: 80,
    patterns: [/退款/, /净成交/, /仅退款/],
  },
  {
    id: "creative_reject_guard",
    label: "素材拒审",
    priority: 70,
    patterns: [/拒审/, /素材.*审核/, /没有可投素材/, /素材.*被拒/],
  },
  {
    id: "learning_phase_diagnosis",
    label: "学习期",
    priority: 60,
    patterns: [/学习期/, /冷启动/],
  },
  {
    id: "budget_reallocation",
    label: "预算分配/重排",
    priority: 50,
    patterns: [/预算.*(分|挪|重排|分配|怎么花)/, /(重排|分配|挪).*预算/, /整体.*ROI.*低/, /预算.*往哪/],
  },
];

export function routeSkill(goal) {
  const text = String(goal ?? "");
  for (const rule of RULES) {
    const pattern = rule.patterns.find((item) => item.test(text));
    if (!pattern) continue;
    const skill = skillById(rule.id);
    if (!skill) continue;
    return {
      skill,
      matchedBy: pattern.source,
      reason: rule.label,
      priority: rule.priority,
      skills: [skill],
      candidates: RULES.filter((item) => item.patterns.some((patternItem) => patternItem.test(text))).map(
        (item) => item.id,
      ),
    };
  }
  return {
    skill: null,
    matchedBy: null,
    reason: "未命中技能，使用基础 expert prompt",
    priority: 0,
    skills: [],
    candidates: [],
  };
}

export function routeSkills(goal) {
  const result = routeSkill(goal);
  return {
    skills: result.skills,
    skillIds: result.skills.map((skill) => skill.id),
    reason: result.reason,
    matchedBy: result.matchedBy,
    candidates: result.candidates,
  };
}

export function skillRouteCatalog() {
  return RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    priority: rule.priority,
    patterns: rule.patterns.map((pattern) => pattern.source),
  }));
}
