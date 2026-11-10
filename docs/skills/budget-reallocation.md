# 技能 02：预算重排

> 在账户之间做 10% 的预算挪移：低 ROI 高消耗降、高 ROI 有空间加。
>
> 为什么做、和业务什么关系、面试怎么讲：见 [技能设计闭环](skill-design.md)。

---

## 1. 解决什么问题

优化师常问：

> “整体 ROI 低，预算该怎么分？”

常见错误：

- 只降预算，不告诉钱去哪；
- 把预算加到库存不足/余额不足的账户；
- 一次改太多账户，无法归因。

这个 skill 的答案：

> **找 1 个低 ROI 高消耗账户降 10%，找 1 个高 ROI 有空间账户加 10%；不暂停、不增加总预算；最多 2 个动作。**

---

## 2. 绑定到谁

| 专家 | 用 skill 做什么 |
| --- | --- |
| 数据分析 `analytics` | 找 donor / recipient，给证据，不提交动作 |
| 广告投放 `ads` | 先 simulate 两侧，再提交两个待确认 Decision |

---

## 3. 触发

- “预算怎么分？”
- “把低 ROI 的预算挪到高 ROI”
- “整体 ROI 低，要不要重排？”

---

## 4. 步骤

1. 数据健康：延迟、授权、缺失；
2. 账户 ROI / 目标 / 消耗，找低 ROI 高消耗 donor；
3. 找 ROI 高于目标、库存/余额有空间的 recipient；
4. 检查两侧库存、余额、消耗占比；
5. simulate donor -10% 和 recipient +10%；
6. 提交两个待确认 Decision；
7. 没有清晰 donor/recipient、库存/余额不足 → 只观察。

---

## 5. 输出

```json
{
  "verdict": "reallocate | observe",
  "moves": [
    { "accountId": "...", "accountName": "...", "deltaPct": -10, "reason": "..." },
    { "accountId": "...", "accountName": "...", "deltaPct": 10, "reason": "..." }
  ],
  "evidence": ["3 条以内，必须带数字"],
  "guardrail": ["不暂停", "不增加总预算", "库存 ≥7 天", "余额 ≥3 天"],
  "confidence": "low | medium | high"
}
```

---

## 6. 失败处理

- 没有清晰 donor / recipient → 只观察；
- 数据缺失 / 延迟 → 只观察；
- recipient 库存 <7 天或余额 <3 天 → 不加；
- 不暂停、不增加总预算、最多 2 个动作。

---

## 7. 评测用例

| case | 场景 | 期望 |
| --- | --- | --- |
| `br-001` | 星野 2.98 → 简味 5.28，库存/余额够 | 降 10% + 加 10% |
| `br-002` | 两个账户都低于目标 | 只观察 |
| `br-003` | 承接账户库存 2 天、余额 1 天 | 只观察 |
| `br-004` | 数据延迟 95 分钟 + 部分授权 | 只观察 |
| `br-005` | 承接账户库存 3 天、余额 2 天 | 只观察 |
| `br-006` | 库存/余额刚好达护栏 | 降 10% + 加 10% |
| `br-007` | 只有一个账户 | 只观察 |
| `br-008` | 承接账户库存 6 天 | 只观察 |
| `br-009` | 承接账户 ROI 刚好等于目标 | 只观察 |
| `br-010` | 数据延迟 + 部分授权 | 只观察 |

用例文件：[budget-reallocation.cases.json](budget-reallocation.cases.json)。

---

## 8. 当前状态

- v0.1：spec + 绑定 analytics/ads + 10 个 case；
- skill 级真实 LLM：**10 / 10 通过**；
- 完整工具链：**pass@3 = 3/3**（donor 星野 18,000→16,200；recipient 简味 19,800→21,780）；
- 报告：[skill 级](budget-reallocation.eval.md)、[完整工具链](budget-reallocation.agent-eval.md)；
- 不扩第三个 skill，先把两个稳定住。
