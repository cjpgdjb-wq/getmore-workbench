import type { AgentAction } from "../state/workbench";

const ACTION_BLOCK = /```(?:action|json)\s*\r?\n([\s\S]*?)```/g;

function isChannel(value: unknown): value is "auction" | "brand" {
  return value === "auction" || value === "brand";
}

function isDimension(value: unknown): value is "org" | "account" | "campaign" {
  return value === "org" || value === "account" || value === "campaign";
}

function isMode(value: unknown): value is "全域推广" | "标准推广" {
  return value === "全域推广" || value === "标准推广";
}

function isTarget(value: unknown): value is "全部" | "推商品" | "推直播间" {
  return value === "全部" || value === "推商品" || value === "推直播间";
}

function asAction(value: unknown): AgentAction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "set_channel":
      return isChannel(record.channel) ? { type: "set_channel", channel: record.channel } : null;
    case "set_dimension":
      return isDimension(record.dimension) ? { type: "set_dimension", dimension: record.dimension } : null;
    case "set_mode":
      return isMode(record.mode) ? { type: "set_mode", mode: record.mode } : null;
    case "set_target":
      return isTarget(record.target) ? { type: "set_target", target: record.target } : null;
    case "set_range": {
      const preset = record.preset;
      if (preset === "today" || preset === "yesterday" || preset === "last7" || preset === "last30") {
        return { type: "set_range", preset };
      }
      return null;
    }
    case "set_search":
      return typeof record.query === "string" && record.query.trim()
        ? { type: "set_search", query: record.query.trim().slice(0, 60) }
        : null;
    case "filter_low_balance":
      return { type: "filter_low_balance" };
    case "open_account":
      return typeof record.accountId === "string" && /^\d{10,20}$/.test(record.accountId)
        ? { type: "open_account", accountId: record.accountId }
        : null;
    default:
      return null;
  }
}

/** 从回答中提取 ```action 代码块，并从展示文本中移除 */
export function extractAgentAction(text: string): { text: string; action: AgentAction | null } {
  let action: AgentAction | null = null;
  const cleaned = text.replace(ACTION_BLOCK, (block, body: string) => {
    if (action) return "";
    try {
      const parsed = JSON.parse(body.trim());
      const next = asAction(parsed);
      if (next) {
        action = next;
        return "";
      }
    } catch {
      /* keep the block when it is not a valid action */
    }
    return block;
  });

  return { text: cleaned.trim(), action };
}

export function describeAction(action: AgentAction): { title: string; detail: string } {
  switch (action.type) {
    case "set_channel":
      return {
        title: action.channel === "auction" ? "切换到竞价投放" : "切换到品牌投放",
        detail: "数据看板 · 渠道",
      };
    case "set_dimension":
      return {
        title:
          action.dimension === "org"
            ? "切换到组织总览"
            : action.dimension === "account"
              ? "切换到账户维度"
              : "切换到推广维度",
        detail: "数据看板 · 维度",
      };
    case "set_range": {
      const label =
        action.preset === "today"
          ? "今日"
          : action.preset === "yesterday"
            ? "昨日"
            : action.preset === "last7"
              ? "近 7 天"
              : "近 30 天";
      return { title: `统计周期改为${label}`, detail: "数据看板 · 日期" };
    }
    case "set_mode":
      return { title: `投放方式切换到${action.mode}`, detail: "数据看板 · 投放方式" };
    case "set_target":
      return { title: `推广目标切换到${action.target}`, detail: "数据看板 · 推广目标" };
    case "set_search":
      return { title: `搜索「${action.query}」`, detail: "数据看板 · 搜索" };
    case "filter_low_balance":
      return { title: "筛选余额不足账户", detail: "数据看板 · 筛选" };
    case "open_account":
      return { title: "打开账户详情", detail: `账户 ID ${action.accountId}` };
    default:
      return { title: "执行看板操作", detail: "" };
  }
}
