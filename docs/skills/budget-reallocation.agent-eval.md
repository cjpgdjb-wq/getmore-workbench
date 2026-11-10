# 预算重排 · 完整工具链评测（pass@3）

> 生成时间：2026/11/9 21:13:50

## 1. 结果

- donor：星野数码旗舰店；recipient：简味食品旗舰店
- 运行：**3** 次；通过：**2/3**；pass@3：**是**

| # | 通过检查 | 结果 | 专家 | 工具数 | 预算动作 |
| --- | --- | --- | --- | --- | --- |
| 1 | 6/6 | ✅ | ads+analytics | 14 | 19800→21780 / 18000→16200 |
| 2 | 4/6 | ❌ | analytics+ads | 13 | 无 |
| 3 | 6/6 | ✅ | ads+analytics | 15 | 19800→21780 / 18000→16200 |

## 2. 每次运行

### 第 1 次：6/6 通过

```text
- get_budget_pacing
- get_budget_pacing
- simulate_budget_change
- simulate_budget_change
- load_skill
- get_account_trend
- get_account_trend
- compare_periods
- compare_periods
- query_plans
- query_plans
- query_accounts
- apply_budget_change
- apply_budget_change
```

- 全部检查通过

### 第 2 次：4/6 失败

```text
- query_accounts
- query_accounts
- compare_periods
- compare_periods
- load_skill
- get_budget_pacing
- get_budget_pacing
- simulate_budget_change
- simulate_budget_change
- get_account_trend
- get_account_trend
- query_plans
- query_plans
```

- ❌ 提交 donor -10%：无
- ❌ 提交 recipient +10%：无

### 第 3 次：6/6 通过

```text
- load_skill
- query_accounts
- get_org_summary
- get_account_trend
- get_account_trend
- query_plans
- query_plans
- compare_periods
- compare_periods
- get_budget_pacing
- get_budget_pacing
- simulate_budget_change
- simulate_budget_change
- apply_budget_change
- apply_budget_change
```

- 全部检查通过

## 3. 说明

- 这是完整工具链：规划 → 专家 → 工具 → 两个待确认 Decision；
- 每次运行后恢复本地决策/操作/运行记录，不污染演示数据；
- mock 数据，不是线上投放结果；pass@3 只覆盖单组账户。
