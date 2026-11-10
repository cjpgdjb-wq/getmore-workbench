/**
 * 专家包加载：agent/experts/<id>.json
 *
 * WorkBuddy 风格的专家 = 人设 + 方法论 + 绑定的技能 + 绑定的连接器。
 * 这里只负责配置；工具实现在 tools.mjs，技能正文在 agent/skills/。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXPERTS_DIR = path.join(ROOT, "agent", "experts");

const DEFAULTS = [
  {
    id: "opportunity",
    order: 1,
    name: "机会洞察",
    role: "市场与增量机会",
    color: "#0aa06e",
    canWrite: false,
    persona: "你从类目趋势、人群资产和竞品动作里找增量机会，不直接改投放。",
    success: "找到的机会可被后续数据验证，且能落到具体账户/人群/预算",
    skillIds: [],
    connectorIds: ["get_market_trends", "get_audience_segments", "find_opportunities"],
  },
  {
    id: "analytics",
    order: 2,
    name: "数据分析",
    role: "经营归因与下钻",
    color: "#2b6bff",
    canWrite: false,
    persona: "你只做诊断、归因和证据，不提交预算/暂停动作；需要动作时交给广告投放专家。",
    success: "结论有可复核的下钻路径，指标口径与看板一致",
    skillIds: [
      "learning_phase_diagnosis",
      "budget_reallocation",
      "inventory_stop_loss",
      "refund_anomaly",
      "creative_reject_guard",
      "weekly_review",
    ],
    connectorIds: ["query_accounts", "query_plans", "get_account_trend", "compare_periods", "get_org_summary"],
  },
  {
    id: "ads",
    order: 3,
    name: "广告投放",
    role: "预算 / 出价 / 计划动作",
    color: "#c2410c",
    canWrite: true,
    persona: "你负责把诊断变成可审批的投放动作；所有动作只提交待确认 Decision，确认后才生效。",
    success: "动作真实生效、ROI 不破底线，且可审计、可撤销",
    skillIds: [
      "learning_phase_diagnosis",
      "budget_reallocation",
      "inventory_stop_loss",
      "refund_anomaly",
      "creative_reject_guard",
    ],
    connectorIds: [
      "get_budget_pacing",
      "get_account_plans",
      "forecast_plan",
      "simulate_budget_change",
      "apply_budget_change",
      "pause_plan",
      "resume_plan",
      "adjust_bid",
    ],
  },
];

function normalize(config, fallback) {
  return {
    ...fallback,
    ...config,
    id: String(config.id ?? fallback.id),
    order: Number(config.order ?? fallback.order ?? 99),
    name: String(config.name ?? fallback.name),
    role: String(config.role ?? fallback.role),
    color: String(config.color ?? fallback.color),
    canWrite: Boolean(config.canWrite ?? fallback.canWrite),
    persona: String(config.persona ?? fallback.persona ?? ""),
    success: String(config.success ?? fallback.success ?? ""),
    skillIds: Array.isArray(config.skillIds) ? config.skillIds.map(String) : fallback.skillIds ?? [],
    connectorIds: Array.isArray(config.connectorIds)
      ? config.connectorIds.map(String)
      : fallback.connectorIds ?? [],
  };
}

export function listExpertConfigs() {
  if (!fs.existsSync(EXPERTS_DIR)) return DEFAULTS.map((config) => ({ ...config }));
  const configs = [];
  for (const entry of fs.readdirSync(EXPERTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(EXPERTS_DIR, entry.name), "utf8"));
      const fallback = DEFAULTS.find((item) => item.id === parsed.id) ?? DEFAULTS[0];
      configs.push(normalize(parsed, fallback));
    } catch {
      /* 单个配置损坏时跳过，避免整个服务起不来 */
    }
  }
  if (configs.length === 0) return DEFAULTS.map((config) => ({ ...config }));
  return configs.sort((left, right) => left.order - right.order);
}

export function expertConfigById(id) {
  return listExpertConfigs().find((config) => config.id === id) ?? null;
}
