# 学习期诊断 · 完整工具链评测（pass@3）

> 生成时间：2026/11/5 15:59:22

## 1. 结果

- 运行：**3** 次
- 通过：**3 / 3**
- pass@3：**是**

| # | 通过检查 | 结果 | 专家 | 工具数 | 预算提案 |
| --- | --- | --- | --- | --- | --- |
| 1 | 6/6 | ✅ | analytics+ads | 10 | 14000→12600 |
| 2 | 6/6 | ✅ | analytics+ads | 8 | 14000→12600 |
| 3 | 6/6 | ✅ | analytics+ads | 10 | 14000→12600 |

## 2. 每次运行

### 第 1 次：6/6 通过

```text
- get_budget_pacing
- get_account_plans
- query_plans
- get_account_trend
- compare_periods
- query_accounts
- simulate_budget_change
- query_plans
- get_org_summary
- apply_budget_change
```

- 全部检查通过

### 第 2 次：6/6 通过

```text
- query_plans
- get_account_trend
- compare_periods
- query_accounts
- get_budget_pacing
- get_account_plans
- simulate_budget_change
- apply_budget_change
```

- 全部检查通过

### 第 3 次：6/6 通过

```text
- query_plans
- query_accounts
- get_account_trend
- compare_periods
- get_budget_pacing
- get_account_plans
- simulate_budget_change
- query_plans
- get_org_summary
- apply_budget_change
```

- 全部检查通过

## 3. 说明

- 这是完整工具链：规划 → 专家 → 工具 → 待确认 Decision；
- 每次运行后恢复本地决策/操作/运行记录，不污染演示数据；
- 仍是 mock 数据，不是线上投放结果；本次 pass@3 = 3/3，表示这 3 次都通过，但仍只覆盖单账户单场景。
