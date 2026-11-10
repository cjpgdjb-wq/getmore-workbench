# 库存止损 · 完整工具链评测（pass@3）

> 生成时间：2026/11/9 21:56:50

## 1. 结果

- 计划：全域-原味燕麦奶 12 盒-晚场直播冲刺（简味食品旗舰店）
- 库存：1296 件，可售约 3 天
- 运行：**3** 次；通过：**3/3**；pass@3：**是**

| # | 通过检查 | 结果 | 专家 | 工具数 | 动作 |
| --- | --- | --- | --- | --- | --- |
| 1 | 5/5 | ✅ | ads+analytics | 8 | pause_plan |
| 2 | 5/5 | ✅ | analytics+ads | 10 | pause_plan |
| 3 | 5/5 | ✅ | ads+analytics | 11 | pause_plan |

## 2. 每次运行

### 第 1 次：5/5 通过

```text
- load_skill
- query_plans
- load_skill
- get_account_plans
- get_budget_pacing
- get_account_trend
- compare_periods
- pause_plan
```

- 全部检查通过

### 第 2 次：5/5 通过

```text
- load_skill
- query_plans
- get_account_trend
- load_skill
- get_budget_pacing
- get_account_plans
- compare_periods
- query_accounts
- simulate_budget_change
- pause_plan
```

- 全部检查通过

### 第 3 次：5/5 通过

```text
- load_skill
- get_budget_pacing
- get_account_plans
- load_skill
- query_accounts
- query_plans
- get_account_trend
- forecast_plan
- compare_periods
- get_org_summary
- pause_plan
```

- 全部检查通过

## 3. 说明

- 这是完整工具链：规划 → 专家 → 查计划/库存 → 待确认 Decision；
- 每次运行后恢复本地决策/操作/运行记录，不污染演示数据；
- mock 数据，不是线上投放结果；pass@3 只覆盖单个低库存计划。
