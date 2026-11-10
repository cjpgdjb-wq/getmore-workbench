/** 全局共享的工具与技能池。商品工作区只做绑定，不复制定义。 */

export type ToolRisk = "read" | "write" | "destructive";

export interface SharedTool {
  id: string;
  name: string;
  description: string;
  category: "机会" | "分析" | "投放";
  risk: ToolRisk;
  defaultEnabled: boolean;
}

export interface SharedSkill {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  instructions: string;
}

export const SHARED_TOOLS: SharedTool[] = [
  { id: "get_market_trends", name: "类目趋势", description: "查询类目热度、增长、竞品动作", category: "机会", risk: "read", defaultEnabled: false },
  { id: "get_audience_segments", name: "人群画像", description: "查询高潜人群规模、TGI、活跃时段", category: "机会", risk: "read", defaultEnabled: false },
  { id: "find_opportunities", name: "机会扫描", description: "扫描账户组合中的增量机会", category: "机会", risk: "read", defaultEnabled: false },
  { id: "query_accounts", name: "账户查询", description: "按消耗/ROI/成本查询账户", category: "分析", risk: "read", defaultEnabled: true },
  { id: "query_plans", name: "计划查询", description: "查询计划消耗、ROI、预算、出价", category: "分析", risk: "read", defaultEnabled: true },
  { id: "get_account_trend", name: "账户趋势", description: "查询账户最近 N 天日序列", category: "分析", risk: "read", defaultEnabled: true },
  { id: "compare_periods", name: "周期对比", description: "对比当前与上一周期表现", category: "分析", risk: "read", defaultEnabled: true },
  { id: "get_org_summary", name: "组织汇总", description: "查询组织维度汇总", category: "分析", risk: "read", defaultEnabled: false },
  { id: "get_budget_pacing", name: "预算进度", description: "查询预算消耗进度与余额", category: "投放", risk: "read", defaultEnabled: true },
  { id: "get_account_plans", name: "计划清单", description: "查询账户下的计划清单", category: "投放", risk: "read", defaultEnabled: true },
  { id: "simulate_budget_change", name: "预算模拟", description: "模拟预算调整后的影响", category: "投放", risk: "read", defaultEnabled: true },
  { id: "apply_budget_change", name: "调整预算", description: "直接调整账户日预算（有护栏）", category: "投放", risk: "write", defaultEnabled: false },
  { id: "pause_plan", name: "暂停计划", description: "直接暂停计划", category: "投放", risk: "destructive", defaultEnabled: false },
  { id: "resume_plan", name: "恢复计划", description: "直接恢复计划", category: "投放", risk: "write", defaultEnabled: false },
  { id: "adjust_bid", name: "调整出价", description: "直接调整计划出价（有护栏）", category: "投放", risk: "write", defaultEnabled: false },
];

export const DEFAULT_TOOL_IDS = SHARED_TOOLS.filter((tool) => tool.defaultEnabled).map((tool) => tool.id);

export const SHARED_SKILLS: SharedSkill[] = [
  {
    id: "product-diagnosis",
    name: "商品投放诊断",
    description: "从效率、结构、库存、退款、数据健康五步诊断商品投放",
    defaultEnabled: true,
    instructions:
      "诊断顺序：先看数据健康与净成交覆盖；再看消耗/ROI/订单成本；再看计划结构与学习期；最后看库存和退款。结论必须区分“效率问题”和“供给/数据问题”。",
  },
  {
    id: "budget-planning",
    name: "预算规划",
    description: "在护栏内规划预算调整幅度、观察窗口和止损线",
    defaultEnabled: true,
    instructions:
      "预算建议必须给出当前值、调整后值、幅度、观察窗口、达标线和止损线；单次不超过 20%；库存不足时不建议加预算。",
  },
  {
    id: "live-review",
    name: "直播复盘",
    description: "按直播间承接、退款、订单成本复盘",
    defaultEnabled: false,
    instructions: "先看直播间订单成本和退款率，再看素材与时段；不把支付 ROI 当利润。",
  },
  {
    id: "creative-review",
    name: "素材复盘",
    description: "按素材审核、点击率和转化成本复盘",
    defaultEnabled: false,
    instructions: "先看素材审核状态和点击率，再看转化成本；缺素材授权时明确说明无法下钻。",
  },
  {
    id: "weekly-report",
    name: "周报生成",
    description: "输出可贴群的商品投放周报",
    defaultEnabled: false,
    instructions: "结论先行，3-5 条数字依据，1-3 条下周动作；不写空话。",
  },
];

export const DEFAULT_SKILL_IDS = SHARED_SKILLS.filter((skill) => skill.defaultEnabled).map((skill) => skill.id);

export function toolById(id: string): SharedTool | undefined {
  return SHARED_TOOLS.find((tool) => tool.id === id);
}

export function skillById(id: string): SharedSkill | undefined {
  return SHARED_SKILLS.find((skill) => skill.id === id);
}
