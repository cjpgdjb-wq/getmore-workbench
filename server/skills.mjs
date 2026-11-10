/**
 * Agent Skills v0.1
 *
 * Skill = 可复用的分析方法 + 工具子集 + 输出要求 + 失败处理 + 评测用例。
 * 技能与工具是两个独立模块：本文件只负责技能；工具在 tools.mjs / tool-registry.mjs。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SKILLS_DIR = path.join(ROOT, "agent", "skills");
const STORE = path.join(process.cwd(), ".runtime", "partner", "skills.json");

export const DEFAULT_SKILLS = [
  {
    id: "learning_phase_diagnosis",
    name: "学习期诊断",
    version: "0.1",
    description: "判断学习期计划该继续、降预算还是只观察，避免误停和误加。",
    businessProblem:
      "学习期计划 ROI 低于目标时，优化师容易走两个极端：直接暂停打断学习，或继续加预算越投越亏。",
    designRationale:
      "把判断固定成一条顺序：数据健康 → 学习期天数 → ROI/订单成本 vs 目标 → 库存/余额 → 只观察或降 10%。样本不足、数据缺失、库存/余额不足时一律只观察。",
    businessMetrics: ["学习期 ROI", "支付 GMV", "订单成本", "回滚率"],
    closedLoop:
      "技能 → 专家 → 工具 → 待确认 Decision → 3–7 天实验 → 复盘 → 回写默认策略；评测发现加预算模板失效后，默认策略已切到只降不增。",
    evidence: ["skill 级 10/10", "完整工具链 pass@3 3/3"],
    trigger: ["计划处于学习期", "ROI 低于目标", "用户问要不要降预算/暂停"],
    expertIds: ["analytics", "ads"],
    toolNames: ["query_plans", "get_account_trend", "get_budget_pacing", "simulate_budget_change"],
    steps: [
      "先看数据健康：延迟、授权、缺失字段",
      "确认是否在学习期，以及学习第几天",
      "对比 7 天 ROI / 订单成本与计划目标",
      "检查消耗占比、库存可售天数、账户余额",
      "样本不足（转化 <20/天）只观察；否则给出降预算或观察建议",
    ],
    output: {
      verdict: "observe | reduce | pause",
      evidence: ["3 条以内，必须带数字"],
      action: "observe 或 budget -10%（交给广告投放专家提交 Decision）",
      guardrail: ["GMV ≥ -5%", "库存 ≥7 天", "余额 ≥3 天"],
      confidence: "low | medium | high",
    },
    failure: "数据延迟/缺失、样本不足、库存不足时，只观察，不硬下结论。",
    instructions:
      "触发：学习期计划 ROI 低于目标，用户问“要不要降预算/暂停”。顺序：数据健康 → 学习期天数 → ROI/订单成本 vs 目标 → 消耗占比/库存/余额 → 结论。样本不足只观察；不要直接暂停学习期计划；如需动作，ads 必须先调用 simulate_budget_change，再提交预算 -10% 的待确认 Decision；没有模拟不得提交。输出：结论 + 3 条数字依据 + 动作 + 护栏。",
    evalCaseFile: "docs/skills/learning-phase-diagnosis.cases.json",
    source: "builtin",
    updatedAt: null,
  },
  {
    id: "budget_reallocation",
    name: "预算重排",
    version: "0.1",
    description: "在账户之间做 10% 的预算挪移：低 ROI 高消耗降、高 ROI 有空间加。",
    businessProblem:
      "整体 ROI 低时，优化师常常只降预算，不告诉钱去哪；或者凭感觉加给高 ROI 账户，没有 donor/recipient 依据。",
    designRationale:
      "先找 1 个低 ROI 高消耗 donor，再找 1 个 ROI 高于目标、库存/余额有空间的 recipient；先模拟两侧，再提交 donor -10% + recipient +10%；不暂停、不增加总预算、最多 2 个动作。",
    businessMetrics: ["账户 ROI", "支付 GMV", "预算使用率", "回滚率"],
    closedLoop:
      "技能 → analytics 找 donor/recipient → ads 模拟并提交两个 Decision → 优化师确认 → 3–7 天复盘；没有清晰 donor/recipient 时只观察。",
    evidence: ["skill 级 10/10", "完整工具链 pass@3 3/3", "donor 18,000→16,200 / recipient 19,800→21,780"],
    trigger: ["预算怎么分", "把低 ROI 的预算挪到高 ROI", "整体 ROI 低"],
    expertIds: ["analytics", "ads"],
    toolNames: ["query_accounts", "get_account_trend", "get_budget_pacing", "simulate_budget_change", "apply_budget_change"],
    steps: [
      "先看数据健康：延迟、授权、缺失字段",
      "对比账户 ROI / 目标 / 消耗，找低 ROI 高消耗账户",
      "找 1 个 ROI 高于目标、库存和余额有空间的账户",
      "检查 donor 和 recipient 的库存、余额、消耗占比",
      "先 simulate 两侧，再提交 donor -10% + recipient +10% 两个待确认 Decision",
    ],
    output: {
      verdict: "reallocate | observe",
      moves: [
        {
          accountId: "string",
          accountName: "string",
          deltaPct: -10,
          reason: "string",
        },
      ],
      evidence: ["3 条以内，必须带数字"],
      guardrail: ["不暂停", "不增加总预算", "库存 ≥7 天", "余额 ≥3 天"],
      confidence: "low | medium | high",
    },
    failure: "没有清晰 donor/recipient、数据缺失、库存不足、余额不足时，只观察，不提交动作。",
    instructions:
      "触发：用户问“预算怎么分/把低 ROI 的预算挪到高 ROI”。步骤：数据健康 → 账户 ROI/目标/消耗 → 找 1 个低 ROI 高消耗 donor + 1 个高 ROI 有空间 recipient → 检查库存/余额 → simulate 两侧 → 提交 donor -10% + recipient +10% 两个待确认 Decision。边界：不暂停、不增加总预算、最多 2 个动作、单次 ±10%。没有清晰 donor/recipient 时只观察。输出：verdict + moves + 3 条数字依据 + 护栏。",
    evalCaseFile: "docs/skills/budget-reallocation.cases.json",
    source: "builtin",
    updatedAt: null,
  },
  {
    id: "inventory_stop_loss",
    name: "库存止损",
    version: "0.1",
    description: "商品库存快断时，判断计划该暂停、降预算还是只观察。",
    businessProblem:
      "高消耗计划还在放量，但商品库存只剩 1–3 天；继续投会带来退款、差评和履约压力，只停计划又可能误伤正常计划。",
    designRationale:
      "先查计划消耗和商品库存，再算可售天数；库存 ≤3 天且计划仍在投放时，优先暂停或降 20%；库存充足、数据缺失或商品已下架时只观察。",
    businessMetrics: ["库存可售天数", "退款率", "支付 GMV", "计划消耗"],
    closedLoop:
      "技能 → ads 提交暂停/降预算 Decision → 优化师确认 → 看退款和 GMV → 回写“低库存计划”规则；库存数据缺失时只观察。",
    evidence: ["skill 级 10/10", "完整工具链 pass@3 3/3"],
    trigger: ["库存快断", "库存只剩 3 天", "这个计划还要不要投"],
    expertIds: ["analytics", "ads"],
    toolNames: ["query_plans", "get_account_plans", "pause_plan", "apply_budget_change"],
    steps: [
      "先看数据健康：库存/商品数据是否可用",
      "查计划消耗、商品库存、可售天数",
      "库存 ≤3 天且计划仍在投放：优先暂停",
      "库存 4–7 天：降预算 20%，不直接暂停",
      "库存充足或数据缺失：只观察",
    ],
    output: {
      verdict: "pause | reduce | observe",
      evidence: ["3 条以内，必须带库存天数和消耗"],
      action: "pause 或 budget -20%",
      guardrail: ["不向库存不足的商品加预算", "暂停/降预算可回滚"],
      confidence: "low | medium | high",
    },
    failure: "库存数据缺失、商品已下架、计划已暂停时，只观察，不提交动作。",
    instructions:
      "触发：商品库存快断，用户问计划还要不要投。顺序：数据健康 → 计划消耗/状态 → 商品库存/可售天数 → 结论。库存 ≤3 天且计划投放中优先暂停；4–7 天降预算 20%；库存充足或数据缺失只观察；不向库存不足的商品加预算。动作只提交待确认 Decision。输出：verdict + 3 条依据 + 动作 + 护栏。",
    evalCaseFile: "docs/skills/inventory-stop-loss.cases.json",
    source: "builtin",
    updatedAt: null,
  },
  {
    id: "refund_anomaly",
    name: "退款异常诊断",
    version: "0.1",
    description: "支付 ROI 好看但退款升高时，判断该降预算还是只观察。",
    businessProblem:
      "支付 ROI 达标不代表赚钱；退款率一高，净成交和利润会被吃掉。优化师容易只看支付 ROI，忽略退款和净成交。",
    designRationale:
      "先看退款/净成交是否授权，再对比本周与上周退款率；退款率 >15% 或环比 +5pp，且 7 天消耗 ≥3,000 时降预算 10%；单日尖刺、数据缺失、低消耗（<3,000）只观察，不直接暂停。",
    businessMetrics: ["退款率", "净成交金额", "支付 ROI", "回滚率"],
    closedLoop: "技能 → analytics 找退款异常计划 → ads 提交降预算 Decision → 3 天看净成交/退款 → 回写阈值。",
    evidence: ["skill 级 5/5", "完整工具链 pass@3 3/3"],
    trigger: ["退款率升高", "净成交变差", "支付 ROI 好看但利润差"],
    expertIds: ["analytics", "ads"],
    toolNames: ["query_plans", "compare_periods", "get_account_trend", "apply_budget_change"],
    steps: [
      "先看净成交/退款是否授权、是否延迟",
      "partialAuth=true 视为净成交未授权：只观察，不要用输入里的 netRevenue 硬做判断",
      "对比本周 vs 上周退款率",
      "定位退款率异常的计划/商品",
      "看净成交、支付 ROI、消耗",
      "退款率 >15% 或环比 +5pp 且 7 天消耗 ≥3,000：降 10%",
      "单日尖刺、数据缺失、消耗 <3,000、计划已暂停：只观察",
    ],
    output: {
      verdict: "reduce | observe",
      evidence: ["3 条以内，必须带退款率和净成交"],
      action: "observe 或 budget -10%",
      guardrail: ["不暂停", "单次降幅 ≤10%", "净成交未授权时只观察"],
      confidence: "low | medium | high",
    },
    failure: "退款/净成交未授权（partialAuth=true）、计划已暂停、数据延迟、单日尖刺、消耗 <3,000 时，只观察。",
    instructions:
      "触发：退款率升高/净成交变差。顺序：授权与数据健康 → 本周 vs 上周退款率 → 异常计划/商品 → 净成交/ROI/消耗 → 结论。partialAuth=true 或计划已暂停时只能观察，不要用输入里的 netRevenue 硬做判断；退款率 >15% 或环比 +5pp 且 7 天消耗 ≥3,000 时才降 10%；单日尖刺、数据缺失、消耗 <3,000 只观察；不直接暂停。",
    evalCaseFile: "docs/skills/refund-anomaly.cases.json",
    source: "builtin",
    updatedAt: null,
  },
  {
    id: "creative_reject_guard",
    name: "素材拒审止损",
    version: "0.1",
    description: "素材被拒审、计划还在花钱时，判断该暂停还是只观察。",
    businessProblem:
      "素材拒审后计划仍可能继续消耗；如果全部素材都被拒，计划实际上没有可交付素材，继续投就是浪费。",
    designRationale:
      "先查计划消耗和素材审核状态；全部素材拒审且仍在消耗 → 暂停；部分拒审 → 只观察并提示替换；计划已暂停/无消耗 → 只观察。",
    businessMetrics: ["拒审素材数", "计划消耗", "可交付素材", "退款率"],
    closedLoop: "技能 → analytics 查拒审素材 → ads 提交暂停 Decision → 优化师换素材/重启 → 回写拒审止损规则。",
    evidence: ["skill 级 5/5", "完整工具链 pass@3 3/3"],
    trigger: ["素材拒审", "没有可投素材", "计划还在消耗"],
    expertIds: ["analytics", "ads"],
    toolNames: ["query_plans", "get_account_plans", "pause_plan"],
    steps: [
      "查计划消耗和素材审核状态",
      "统计通过/拒绝素材数",
      "全部素材拒审且计划仍在消耗：暂停",
      "只有部分拒审：只观察，提示替换被拒素材",
      "计划已暂停/无消耗：只观察",
    ],
    output: {
      verdict: "pause | observe",
      evidence: ["3 条以内，必须带拒审素材数和消耗"],
      action: "pause_plan 或 observe",
      guardrail: ["不重复暂停", "暂停可回滚"],
      confidence: "low | medium | high",
    },
    failure: "素材数据缺失、计划已暂停、无消耗时，只观察；全部拒审时不得建议恢复投放。",
    instructions:
      "触发：素材拒审/计划还在消耗。顺序：计划消耗 → 素材审核状态 → 通过/拒绝数量 → 结论。全部素材拒审且仍在消耗只能暂停或只观察，严禁建议恢复投放/维持投放；部分拒审只观察并提示替换；计划已暂停/无消耗只观察。",
    evalCaseFile: "docs/skills/creative-reject-guard.cases.json",
    source: "builtin",
    updatedAt: null,
  },
  {
    id: "weekly_review",
    name: "周报复盘",
    version: "0.1",
    description: "把一周的账户/计划变化整理成可贴群的周报，不提交动作。",
    businessProblem:
      "优化师每周都要写复盘：拉数、对比、找变化、写下周动作；重复劳动，而且容易漏掉数据缺口。",
    designRationale:
      "固定结构：本周总览 → 本周 vs 上周 → 3 个关键变化 → 2 个下周动作 → 数据缺口。只读，不提交 Decision；缺数据显式说明。",
    businessMetrics: ["消耗", "支付 GMV", "ROI", "订单成本", "数据完整度"],
    closedLoop: "技能 → 汇总本周数据 → 输出周报 → 优化师贴群/周会 → 下周动作进入任务；不生成 Decision。",
    evidence: ["skill 级 5/5", "只读 pass@3 3/3"],
    trigger: ["写周报", "本周复盘", "汇报本周投放"],
    expertIds: ["analytics"],
    toolNames: ["query_accounts", "query_plans", "compare_periods", "get_org_summary"],
    steps: [
      "拉本周账户/计划汇总",
      "对比本周 vs 上周",
      "找 3 个关键变化",
      "给 2 个下周动作",
      "显式写数据缺口",
    ],
    output: {
      verdict: "report",
      report: "Markdown 周报",
      evidence: ["3 条以内，必须带数字"],
      guardrail: ["只读，不提交动作", "缺数据显式说明"],
      confidence: "low | medium | high",
    },
    failure: "数据缺失/延迟时，在周报里写明，不推断缺失为 0。",
    instructions:
      "触发：用户要写周报/本周复盘。report 必须包含 5 个二级标题：本周总览、本周 vs 上周、3 个关键变化、2 个下周动作、数据缺口。只读，不提交 Decision；缺数据显式说明，不推断为 0；compare_periods 缺失时写“上周数据缺失”，不得编造环比。输出 JSON：verdict=report + report Markdown（≤400 字）+ evidence + guardrail + confidence。",
    evalCaseFile: "docs/skills/weekly-review.cases.json",
    source: "builtin",
    updatedAt: null,
  },
];

function normalizeSkill(input) {
  if (!input || typeof input !== "object") throw new Error("技能必须是 JSON 对象");
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const version = String(input.version ?? "").trim();
  if (!id || !name || !version) throw new Error("技能需要 id / name / version");
  if (!Array.isArray(input.expertIds) || input.expertIds.length === 0) throw new Error("技能需要 expertIds");
  if (!Array.isArray(input.toolNames) || input.toolNames.length === 0) throw new Error("技能需要 toolNames");
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error("技能需要 steps");
  if (!input.output || typeof input.output !== "object") throw new Error("技能需要 output");
  return {
    ...input,
    id,
    name,
    version,
    description: String(input.description ?? ""),
    businessProblem: String(input.businessProblem ?? ""),
    designRationale: String(input.designRationale ?? ""),
    businessMetrics: Array.isArray(input.businessMetrics) ? input.businessMetrics.map(String) : [],
    closedLoop: String(input.closedLoop ?? ""),
    evidence: Array.isArray(input.evidence) ? input.evidence.map(String) : [],
    trigger: Array.isArray(input.trigger) ? input.trigger.map(String) : [],
    expertIds: input.expertIds.map(String),
    toolNames: input.toolNames.map(String),
    steps: input.steps.map(String),
    instructions: String(input.instructions ?? ""),
    failure: String(input.failure ?? ""),
    evalCaseFile: String(input.evalCaseFile ?? ""),
    source: input.source === "builtin" ? "builtin" : input.source ?? "imported",
    updatedAt: Date.now(),
  };
}

function stripFrontmatter(markdown) {
  const text = String(markdown ?? "");
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? text.slice(match[0].length) : text).trim();
}

/** 读取 agent/skills/<id>/{SKILL.md,skill.json} 目录包 */
function readFileSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SKILLS_DIR, entry.name);
    const docPath = path.join(dir, "SKILL.md");
    if (!fs.existsSync(docPath)) continue;
    let metadata = {};
    try {
      metadata = JSON.parse(fs.readFileSync(path.join(dir, "skill.json"), "utf8"));
    } catch {
      /* skill.json 可选 */
    }
    const fallback = DEFAULT_SKILLS.find((skill) => skill.id === (metadata.id ?? entry.name)) ?? {};
    skills.push({
      ...fallback,
      ...metadata,
      id: metadata.id ?? entry.name,
      name: metadata.name ?? fallback.name ?? entry.name,
      version: metadata.version ?? fallback.version ?? "0.1",
      description: metadata.description ?? fallback.description ?? "",
      expertIds: metadata.expertIds ?? fallback.expertIds ?? [],
      toolNames: metadata.toolNames ?? fallback.toolNames ?? [],
      trigger: metadata.triggers ?? metadata.trigger ?? fallback.trigger ?? [],
      steps: metadata.steps ?? fallback.steps ?? [],
      output: metadata.output ?? fallback.output ?? {},
      failure: metadata.failure ?? fallback.failure ?? "",
      businessProblem: metadata.businessProblem ?? fallback.businessProblem ?? "",
      designRationale: metadata.designRationale ?? fallback.designRationale ?? "",
      businessMetrics: metadata.businessMetrics ?? fallback.businessMetrics ?? [],
      closedLoop: metadata.closedLoop ?? fallback.closedLoop ?? "",
      evidence: metadata.evidence ?? fallback.evidence ?? [],
      instructions: stripFrontmatter(fs.readFileSync(docPath, "utf8")),
      docPath,
      source: "file",
      updatedAt: null,
    });
  }
  const order = new Map(DEFAULT_SKILLS.map((skill, index) => [skill.id, index]));
  return skills.sort((left, right) => (order.get(left.id) ?? 999) - (order.get(right.id) ?? 999));
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE, "utf8"));
    const skills = Array.isArray(raw) ? raw : raw.skills;
    if (!Array.isArray(skills)) return [];
    return skills;
  } catch {
    return [];
  }
}

function writeStore(skills) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify({ skills }, null, 2), "utf8");
}

export function listSkills() {
  const files = readFileSkills();
  const stored = readStore();
  if (files.length === 0) return stored.length ? stored : [...DEFAULT_SKILLS];
  // 文件是内置技能的源；store 里同 id 的编辑/导入覆盖文件。
  const merged = new Map(files.map((skill) => [skill.id, skill]));
  for (const skill of stored) {
    merged.set(skill.id, { ...(merged.get(skill.id) ?? {}), ...skill, source: skill.source ?? "edited" });
  }
  return [...merged.values()];
}

export function skillById(id) {
  return listSkills().find((skill) => skill.id === id) ?? null;
}

export function skillsForExpert(expertId) {
  return listSkills().filter((skill) => (skill.expertIds ?? []).includes(expertId));
}

export function skillCatalogForExpert(expertId) {
  return skillsForExpert(expertId).map((skill) => ({
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
  }));
}

/** 给 planner 的技能摘要：只给名称/描述/绑定，不给全文 */
export function skillCatalogForPlanner() {
  return listSkills().map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    expertIds: skill.expertIds ?? [],
    triggers: skill.trigger ?? [],
  }));
}

/** 渐进披露：专家 prompt 里只放摘要，完整步骤由 load_skill 读取 */
export function skillSummaryBlock(expertId, selectedSkillIds = null) {
  const all = skillsForExpert(expertId);
  const skills = Array.isArray(selectedSkillIds)
    ? all.filter((skill) => selectedSkillIds.includes(skill.id))
    : all;
  if (!skills.length) return "";
  const lines = ["可用技能（先看摘要；需要完整步骤/阈值时调用 load_skill 读取全文）："];
  for (const skill of skills) {
    lines.push(`【${skill.name} v${skill.version}】${skill.description}`);
    if ((skill.trigger ?? []).length) lines.push(`触发：${skill.trigger.join(" / ")}`);
    lines.push(`读取完整技能：load_skill({"skill_id":"${skill.id}"})`);
  }
  if (expertId === "analytics") {
    lines.push("边界：你只做诊断和证据，不提交预算/暂停动作；需要动作时明确交给广告投放专家。");
  }
  if (expertId === "ads") {
    lines.push("边界：动作只提交待确认 Decision；必须先调用 simulate_budget_change 验证，再提交；不要写“已执行”。");
  }
  return lines.join("\n");
}

export function loadSkillDetail(id, expertId = null) {
  const skill = skillById(id);
  if (!skill) return null;
  if (expertId && !(skill.expertIds ?? []).includes(expertId)) return null;
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    instructions: skill.instructions,
    steps: skill.steps ?? [],
    output: skill.output ?? {},
    failure: skill.failure,
    docPath: skill.docPath ?? null,
    source: skill.source ?? "builtin",
  };
}

export function saveSkill(input) {
  const existing = input?.id ? listSkills().find((item) => item.id === input.id) : null;
  const skill = normalizeSkill({ ...(existing ?? {}), ...input });
  const skills = listSkills();
  const index = skills.findIndex((item) => item.id === skill.id);
  if (index >= 0) skills[index] = skill;
  else skills.push(skill);
  writeStore(skills);
  return skill;
}

export function deleteSkill(id) {
  const skills = listSkills();
  const next = skills.filter((skill) => skill.id !== id);
  if (next.length === skills.length) throw new Error("技能不存在");
  writeStore(next);
  return { ok: true };
}

export function skillPromptBlock(expertId, selectedSkillIds = null) {
  const all = skillsForExpert(expertId);
  const skills = Array.isArray(selectedSkillIds)
    ? all.filter((skill) => selectedSkillIds.includes(skill.id))
    : all;
  if (!skills.length) return "";
  const lines = ["可用技能（按需使用，不要为了用技能而用）："];
  for (const skill of skills) {
    lines.push(`【${skill.name} v${skill.version}】${skill.instructions}`);
    if (expertId === "analytics") {
      lines.push("边界：你只做诊断和证据，不提交预算/暂停动作；需要动作时明确交给广告投放专家。");
    }
    if (expertId === "ads") {
      lines.push("边界：动作只提交待确认 Decision；必须先调用 simulate_budget_change 验证，再提交；不要写“已执行”。");
    }
    lines.push(`失败处理：${skill.failure}`);
  }
  return lines.join("\n");
}




