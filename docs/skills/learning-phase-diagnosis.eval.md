# 学习期诊断 · 真实 LLM 评测 v0.1

> 生成时间：2026/11/5 15:14:03

## 1. 结果

- 样本：10 个 case
- 通过：**10 / 10**
- verdict 一致：10 / 10
- 命中禁止项：0 个 case

| case | 期望 | 实际 | verdict | 必含词 | 禁止词 | 动作 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| lp-001 学习期低 ROI，样本足够 | reduce | reduce | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-002 学习期样本不足 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-003 学习期但库存/余额不足 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-004 数据延迟 + 部分授权 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-005 库存和余额同时偏紧 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-006 转化 19/天，刚好低于样本门槛 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-007 转化 20/天，刚好达到样本门槛 | reduce | reduce | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-008 库存 7 天、余额 3 天，刚好达护栏 | reduce | reduce | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-009 数据延迟 60 分钟 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| lp-010 计划已暂停，不重复提交 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |

## 2. 模型输出

### lp-001 学习期低 ROI，样本足够

```json
{
  "verdict": "reduce",
  "evidence": [
    "学习第5天，7天ROI 2.8 低于目标3.5，差距0.7（约-20%）",
    "日均转化30，高于20样本阈值；数据延迟12分钟且partialAuth=false，数据健康可判断",
    "消耗占比32%，库存20天≥7天，余额5天≥3天，具备降预算缓冲"
  ],
  "action": "budget -10%（先 simulate_budget_change，再由广告投放专家提交待确认 Decision）",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "medium"
}
```

### lp-002 学习期样本不足

```json
{
  "verdict": "observe",
  "evidence": [
    "学习期第 2 天，7 天 ROI 为 2.6，低于目标 4；但日均转化仅 8 次（<20），样本不足，暂不据此做硬性动作",
    "数据延迟 18 分钟、无部分授权缺失；消耗占比 18%，库存可售 30 天、余额可支撑 6 天，均未触发停止条件",
    "当前处于学习期且转化不足，按技能只观察，不直接暂停或降预算"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "medium"
}
```

### lp-003 学习期但库存/余额不足

```json
{
  "verdict": "observe",
  "evidence": [
    "学习第8天，7天ROI=3.0，低于目标3.5（差14.3%）",
    "转化25/天≥20，但库存可售2天<7天、余额1天<3天，不具备降预算或暂停条件",
    "数据延迟35分钟且partialAuth=true，消耗占比45%，数据健康不足，置信度低"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low"
}
```

### lp-004 数据延迟 + 部分授权

```json
{
  "verdict": "observe",
  "evidence": [
    "学习第6天，ROI 2.4 低于目标 4；转化 22/天，样本刚超过 20 门槛",
    "数据延迟 95 分钟且授权不完整（partialAuth=true），数据健康不足",
    "库存 15 天、余额 5 天均高于护栏（7天/3天），消耗占比 28%"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low"
}
```

### lp-005 库存和余额同时偏紧

```json
{
  "verdict": "observe",
  "evidence": [
    "学习第9天，7天ROI为2.9，低于目标3.5（差0.6，约17%）",
    "日均转化25次，高于20次样本门槛，样本充足",
    "库存可售3天低于7天、余额可用2天低于3天，消耗占比38%"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "medium"
}
```

### lp-006 转化 19/天，刚好低于样本门槛

```json
{
  "verdict": "observe",
  "evidence": [
    "学习期第6天，roi7d=3.0低于目标3.5，差距约14.3%",
    "日均转化19 < 20，样本不足，不硬下结论",
    "库存可售20天、余额5天、数据延迟10分钟，数据健康可观察"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low"
}
```

### lp-007 转化 20/天，刚好达到样本门槛

```json
{
  "verdict": "reduce",
  "evidence": [
    "学习第6天，ROI7d 3.0 低于目标3.5，差0.5（约14%）",
    "日均转化20，达到样本阈值（非<20/天），可做判断",
    "消耗占比25%，库存可售20天，余额5天，均高于停止/观察阈值；数据延迟10分钟且授权正常"
  ],
  "action": "budget -10%（先 simulate_budget_change，再由广告投放专家提交待确认 Decision）",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "medium"
}
```

### lp-008 库存 7 天、余额 3 天，刚好达护栏

```json
{
  "verdict": "reduce",
  "evidence": [
    "学习第 6 天，ROI7d 为 3.0，目标为 3.5，低于目标 0.5（约 14%）。",
    "转化 30/天（≥20），样本充足；消耗占比 25%，数据延迟 10 分钟、授权正常。",
    "库存可售 7 天、余额可用 3 天，均处于护栏下限。"
  ],
  "action": "budget -10%（交给广告投放专家提交 Decision）",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "medium"
}
```

### lp-009 数据延迟 60 分钟

```json
{
  "verdict": "observe",
  "evidence": [
    "学习期第6天，ROI 7天为3.0，低于目标3.5",
    "日均转化19次/天，低于20次/天的样本门槛，暂不足以判定计划失效",
    "消耗占比25%，库存可售20天、余额5天；数据延迟60分钟，无部分授权缺失"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low"
}
```

### lp-010 计划已暂停，不重复提交

```json
{
  "verdict": "observe",
  "evidence": [
    "学习第6天，ROI 3.0 低于目标3.5，差0.5（约-14.3%）",
    "日均转化19 < 20，样本不足，仅观察",
    "cost7d=0且计划已暂停；库存20天≥7天，余额5天≥3天"
  ],
  "action": "observe",
  "guardrail": [
    "GMV ≥ -5%",
    "库存 ≥7 天",
    "余额 ≥3 天"
  ],
  "confidence": "low"
}
```

## 3. 说明

- 这是 skill 级 LLM 评测：给模型 skill + case 数据，不调用工具；
- 评分使用同义表达（如 budget -10% / 预算 -10%），避免把语义正确判成失败；
- 禁止词只检查 verdict / moves / action，不检查 guardrail 里的“不暂停”等否定句；
- 不是完整 Agent 工具链评测，也不是线上投放结果；
- 通过只说明模型能按 skill 约束输出，不代表真实业务有效。
