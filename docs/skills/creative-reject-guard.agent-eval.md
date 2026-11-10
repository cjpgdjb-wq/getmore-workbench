# 素材拒审止损 · 完整工具链评测（pass@3）

> 生成时间：2026/11/5 15:52:26

## 1. 结果

- 计划：标准-冷萃茶包组合-达人相似人群（简味食品旗舰店）
- 运行：**3** 次；通过：**3/3**；pass@3：**是**

| # | 通过检查 | 结果 | 专家 | 工具数 | 动作 |
| --- | --- | --- | --- | --- | --- |
| 1 | 5/5 | ✅ | analytics+ads+opportunity | 15 | pause_plan |
| 2 | 5/5 | ✅ | analytics+ads+opportunity | 10 | pause_plan |
| 3 | 5/5 | ✅ | analytics+ads+opportunity | 11 | pause_plan |

## 2. 每次运行

### 第 1 次：5/5 通过

```text
- get_account_plans
- get_budget_pacing
- query_plans
- query_accounts
- get_account_trend
- compare_periods
- find_opportunities
- get_market_trends
- get_market_trends
- get_market_trends
- get_market_trends
- get_audience_segments
- get_audience_segments
- get_audience_segments
- pause_plan
```

- 全部检查通过

### 第 2 次：5/5 通过

```text
- query_plans
- get_account_trend
- get_budget_pacing
- get_account_plans
- get_market_trends
- get_audience_segments
- find_opportunities
- query_plans
- query_accounts
- pause_plan
```

- 全部检查通过

### 第 3 次：5/5 通过

```text
- query_plans
- get_account_trend
- query_accounts
- get_budget_pacing
- get_account_plans
- find_opportunities
- get_market_trends
- get_audience_segments
- pause_plan
- query_plans
- query_plans
```

- 全部检查通过

## 3. 说明

- 完整工具链：规划 → 专家 → 查计划/素材 → 待确认暂停；
- 每次运行后恢复本地决策/操作/运行记录；
- mock 数据，不是线上审核；pass@3 只覆盖单个全部拒审计划。
