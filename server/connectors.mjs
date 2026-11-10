/**
 * Connector 适配层（WorkBuddy 风格的第一版）。
 *
 * 现在业务工具还跑在进程内，但对外统一成 connector：
 * - id / 名称 / 描述 / 参数
 * - 风险：read / write / destructive
 * - 授权的专家
 * - 授权状态（演示环境统一 mock，接 MCP/OAuth 时替换这里）
 * - callConnector() 统一入口
 *
 * 下一步接真实 MCP 时，只需要把这些 connector 的 handler 换成 MCP client，
 * 上层专家/编排不用改。
 */
import { EXPERTS, executeTool } from "./tools.mjs";
import { getMcpClient } from "./mcp-client.mjs";

let mcpWarned = false;

const TOOL_LABELS = {
  get_market_trends: "类目趋势",
  get_audience_segments: "人群画像",
  find_opportunities: "机会扫描",
  query_accounts: "账户查询",
  query_plans: "计划查询",
  get_account_trend: "账户趋势",
  compare_periods: "周期对比",
  get_org_summary: "组织汇总",
  get_budget_pacing: "预算进度",
  get_account_plans: "计划清单",
  forecast_plan: "计划预测",
  simulate_budget_change: "预算模拟",
  apply_budget_change: "调整预算",
  pause_plan: "暂停计划",
  resume_plan: "恢复计划",
  adjust_bid: "调整出价",
};

const WRITE_TOOLS = new Set(["apply_budget_change", "pause_plan", "resume_plan", "adjust_bid"]);

export const CONNECTOR_AUTH = {
  mode: "mock",
  status: "connected",
  note: "演示环境：工具在进程内执行，授权状态为模拟；接 MCP/OAuth 时替换 connector.auth。",
};

function riskOf(name) {
  if (name === "pause_plan") return "destructive";
  if (WRITE_TOOLS.has(name)) return "write";
  return "read";
}

export function listConnectors() {
  const byId = new Map();
  for (const expert of EXPERTS) {
    for (const tool of expert.tools) {
      if (!byId.has(tool.name)) {
        byId.set(tool.name, {
          id: tool.name,
          name: TOOL_LABELS[tool.name] ?? tool.name,
          description: tool.description,
          parameters: tool.parameters,
          risk: riskOf(tool.name),
          canWrite: WRITE_TOOLS.has(tool.name),
          requiresApproval: WRITE_TOOLS.has(tool.name),
          expertIds: [],
          expertNames: [],
          auth: { ...CONNECTOR_AUTH },
          enabled: true,
        });
      }
      const connector = byId.get(tool.name);
      if (!connector.expertIds.includes(expert.id)) connector.expertIds.push(expert.id);
      if (!connector.expertNames.includes(expert.name)) connector.expertNames.push(expert.name);
    }
  }
  return [...byId.values()];
}

export function connectorById(id) {
  return listConnectors().find((connector) => connector.id === id) ?? null;
}

export function connectorsForExpert(expertId) {
  return listConnectors().filter((connector) => connector.expertIds.includes(expertId));
}

/** 统一调用入口：优先走本地 MCP Server；MCP 不可用时回退进程内。 */
export async function callConnector(expertId, connectorId, args, ctx) {
  const connector = connectorById(connectorId);
  if (!connector) return { ok: false, error: `连接器不存在：${connectorId}` };
  if (!connector.enabled) return { ok: false, error: `连接器已禁用：${connectorId}` };
  if (!connector.expertIds.includes(expertId)) {
    return { ok: false, error: `专家 ${expertId} 无权调用连接器 ${connectorId}` };
  }

  const client = getMcpClient();
  if (client) {
    try {
      const result = await client.callTool(connectorId, args, {
        expertId,
        runId: ctx?.runId,
        range: ctx?.range,
        channel: ctx?.channel,
        accountId: ctx?.accountId ?? null,
        requestedTargets: ctx?.requestedTargets,
        expectsAction: ctx?.expectsAction,
        writeBlocked: ctx?.writeBlocked,
      });
      if (result && typeof result === "object") {
        return { ...result, meta: { ...(result.meta ?? {}), transport: "mcp" } };
      }
    } catch (error) {
      if (!mcpWarned) {
        mcpWarned = true;
        process.stderr.write(
          `[connectors] MCP 调用失败，回退进程内：${error instanceof Error ? error.message : error}\n`,
        );
      }
    }
  }
  return executeTool(expertId, connectorId, args, ctx);
}

export function connectorCatalogForExpert(expertId) {
  return connectorsForExpert(expertId).map((connector) => ({
    id: connector.id,
    name: connector.name,
    description: connector.description,
    risk: connector.risk,
    requiresApproval: connector.requiresApproval,
  }));
}
