# 素材拒审止损 · 真实 LLM 评测 v0.1

> 生成时间：2026/11/5 15:21:52

## 1. 结果

- 样本：5 个 case
- 通过：**5 / 5**
- verdict 一致：5 / 5
- 命中禁止项：0 个 case

| case | 期望 | 实际 | verdict | 必含词 | 禁止词 | 动作 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cr-001 全部素材拒审，计划仍在消耗 | pause | pause | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| cr-002 1/2 素材拒审，仍有可投素材 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| cr-003 没有拒审素材 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| cr-004 全部拒审但计划已暂停 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |
| cr-005 素材数据缺失 | observe | observe | ✅ | 全中 | 无 | ✅ 不检查 | 通过 |

## 2. 模型输出

### cr-001 全部素材拒审，计划仍在消耗

```json
{
  "verdict": "pause",
  "evidence": [
    "计划状态为投放中，7日消耗15402",
    "素材总数1，拒审素材数1，全部素材拒审",
    "唯一素材拒审原因：背景音乐版权待确认，计划仍在消耗"
  ],
  "action": "pause_plan",
  "guardrail": [
    "不重复暂停",
    "暂停可回滚"
  ],
  "confidence": "high"
}
```

### cr-002 1/2 素材拒审，仍有可投素材

```json
{
  "verdict": "observe",
  "evidence": [
    "计划 plan_cr_1 状态为投放中，7日消耗 15402",
    "素材共 2 个，其中 1 个被拒审：便携蓝牙音箱-场景种草（背景音乐版权待确认）",
    "仅部分素材拒审，计划仍在消耗，不满足全部拒审暂停条件"
  ],
  "action": "observe",
  "guardrail": [
    "不重复暂停",
    "暂停可回滚"
  ],
  "confidence": "high"
}
```

### cr-003 没有拒审素材

```json
{
  "verdict": "observe",
  "evidence": [
    "计划「标准-便携蓝牙音箱-爆品追投」投放中，7日消耗15402",
    "素材总数2，拒审素材数0，无被拒素材",
    "当前无素材拒审，不触发暂停条件"
  ],
  "action": "observe",
  "guardrail": [
    "不重复暂停",
    "暂停可回滚"
  ],
  "confidence": "high"
}
```

### cr-004 全部拒审但计划已暂停

```json
{
  "verdict": "observe",
  "evidence": [
    "计划「标准-便携蓝牙音箱-爆品追投」状态为已暂停，7日消耗为0",
    "素材总数为1，拒审素材数为1（便携蓝牙音箱-场景种草，原因：背景音乐版权待确认）",
    "计划已暂停且无消耗，按技能仅观察，不重复暂停"
  ],
  "action": "observe",
  "guardrail": [
    "不重复暂停",
    "暂停可回滚"
  ],
  "confidence": "high"
}
```

### cr-005 素材数据缺失

```json
{
  "verdict": "observe",
  "evidence": [
    "计划 plan_cr_1「标准-便携蓝牙音箱-爆品追投」状态为投放中，7 日消耗 15402",
    "素材数据缺失：creativeCount=0、rejectedCount=0、rejectedCreatives 为空，无法统计通过和拒绝的素材数量",
    "无任何拒审素材记录，数据延迟 10 分钟，因此不满足「全部素材拒审且仍在消耗」的暂停条件"
  ],
  "action": "observe",
  "guardrail": [
    "不重复暂停",
    "暂停可回滚"
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
