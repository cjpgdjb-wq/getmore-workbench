---
name: "预算重排"
description: "在账户之间做 10% 的预算挪移：低 ROI 高消耗降、高 ROI 有空间加。"
version: "0.1"
expertIds: ["analytics", "ads"]
triggers: ["预算怎么分", "把低 ROI 的预算挪到高 ROI", "整体 ROI 低"]
toolNames: ["query_accounts", "get_account_trend", "get_budget_pacing", "simulate_budget_change", "apply_budget_change"]
---

# 预算重排

在账户之间做 10% 的预算挪移：低 ROI 高消耗降、高 ROI 有空间加。

## 什么时候用

- 预算怎么分
- 把低 ROI 的预算挪到高 ROI
- 整体 ROI 低

## 业务问题

整体 ROI 低时，优化师常常只降预算，不告诉钱去哪；或者凭感觉加给高 ROI 账户，没有 donor/recipient 依据。

## 方法

先找 1 个低 ROI 高消耗 donor，再找 1 个 ROI 高于目标、库存/余额有空间的 recipient；先模拟两侧，再提交 donor -10% + recipient +10%；不暂停、不增加总预算、最多 2 个动作。

## 步骤

1. 先看数据健康：延迟、授权、缺失字段
2. 对比账户 ROI / 目标 / 消耗，找低 ROI 高消耗账户
3. 找 1 个 ROI 高于目标、库存和余额有空间的账户
4. 检查 donor 和 recipient 的库存、余额、消耗占比
5. 先 simulate 两侧，再提交 donor -10% + recipient +10% 两个待确认 Decision

## 输出

```json
{
  "verdict": "reallocate | observe",
  "moves": [
    {
      "accountId": "string",
      "accountName": "string",
      "deltaPct": -10,
      "reason": "string"
    }
  ],
  "evidence": [
    "3 条以内，必须带数字"
  ],
  "guardrail": [
    "不暂停",
    "不增加总预算",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low | medium | high"
}
```

## 护栏

- 不暂停
- 不增加总预算
- 库存 ≥7 天
- 余额 ≥3 天

## 失败处理

没有清晰 donor/recipient、数据缺失、库存不足、余额不足时，只观察，不提交动作。

## 使用边界

- 技能只提供方法与判断顺序，不直接执行动作；动作由工具提交，写操作必须人工确认。
- 没有工具返回的数字，不要编造；缺数据时按失败处理执行。
