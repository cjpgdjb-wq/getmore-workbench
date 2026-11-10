# 退款异常诊断 · 完整工具链评测（pass@3）

> 生成时间：2026/11/6 12:19:13

## 1. 结果

- 计划：标准-智能运动手表-商品卡推广（星野数码旗舰店）
- 运行：**3** 次；通过：**2/3**；pass@3：**是**

| # | 通过检查 | 结果 | 专家 | 工具数 | 动作 |
| --- | --- | --- | --- | --- | --- |
| 1 | 5/5 | ✅ | analytics+ads | 9 | apply_budget_change |
| 2 | 4/5 | ❌ | analytics+ads | 7 | 无 |
| 3 | 5/5 | ✅ | analytics+ads | 7 | apply_budget_change |

## 2. 每次运行

### 第 1 次：5/5 通过

```text
- query_plans
- get_account_trend
- compare_periods
- get_budget_pacing
- get_account_plans
- query_plans
- compare_periods
- simulate_budget_change
- apply_budget_change
```

- 全部检查通过

### 第 2 次：4/5 失败

```text
- query_plans
- compare_periods
- get_budget_pacing
- get_account_plans
- query_plans
- get_account_trend
- query_accounts
```

- ❌ 提交降 10%：无

### 第 3 次：5/5 通过

```text
- query_plans
- get_account_trend
- compare_periods
- get_budget_pacing
- get_account_plans
- simulate_budget_change
- apply_budget_change
```

- 全部检查通过

## 3. 说明

- 完整工具链：规划 → 专家 → 查退款/净成交 → 待确认降预算；
- 每次运行后恢复本地决策/操作/运行记录；
- mock 数据，不是线上退款；pass@3 只覆盖单个高退款计划。
