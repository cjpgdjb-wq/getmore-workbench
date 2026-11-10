# 策略实验 · 历史回放评测

> 生成时间：2026/11/5 12:21:08

## 1. 结论

- 样本：**30** 个历史 T0（T+7 事后标签）
- 规则动作方向准确率：**76.7%**
- 动作方向 + 护栏都通过：**66.7%**
- baseline（永远只观察）：60.0%
- baseline（永远降预算）：33.3%
- 预测校准 MAE：0.27（21 条可校准）
- 护栏：通过 4 / 13，违规 9

> 读法：方向准确率只看“该不该动”；真正执行动作的 13 个里只有 4 个通过 GMV 护栏。说明规则“方向大致对，但动作偏多/偏重”。

## 2. 事后标签分布

| 事后标签 | 数量 |
| --- | --- |
| 只观察 | 18 |
| 降预算/收缩 | 10 |
| 加预算/放量 | 2 |

## 3. 混淆矩阵

| 事后标签 → 建议动作 | 数量 |
| --- | --- |
| reduce->reduce | 4 |
| observe->observe | 17 |
| increase->increase | 2 |
| reduce->increase | 6 |
| observe->increase | 1 |

## 4. Badcase

| case | 范围 | 建议 | 事后标签 | 原因 |
| --- | --- | --- | --- | --- |
| 2026-10-29-rec_learning_phase_1739810000031676 | 标准-纯棉四件套-晚场直播冲刺 · 轻氧家居旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-28-rec_budget_cap_1723560000016063 | 潮玩星球旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD 0.05，GMV 相对 -15.2%） |
| 2026-10-28-rec_learning_phase_1739810000031676 | 标准-纯棉四件套-晚场直播冲刺 · 轻氧家居旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-26-rec_budget_cap_1723560000002385 | 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD 0.13，GMV 相对 -34.7%） |
| 2026-10-26-rec_high_roi_low_spend_1739810000015838 | 标准-羊毛混纺大衣-商品卡推广 · 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.27，GMV 相对 -6.3%） |
| 2026-10-24-rec_high_roi_low_spend_1739810000015838 | 标准-羊毛混纺大衣-商品卡推广 · 拾光服饰旗舰店 | increase | observe | 建议 increase，事后标签 observe（DiD 0.12，GMV 相对 11.2%） |
| 2026-10-22-rec_budget_cap_1723560000006293 | 初见美妆旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.70，GMV 相对 -18.5%） |
| 2026-10-22-rec_low_roi_high_spend_1739810000142542 | 标准-轻量徒步鞋-短视频带货 · 沐野运动旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-19-rec_budget_cap_1723560000002385 | 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.57，GMV 相对 -11.4%） |
| 2026-10-19-rec_high_roi_low_spend_1739810000017677 | 标准-羊毛混纺大衣-爆品追投 · 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.20，GMV 相对 -8.3%） |

## 5. 下一步

- 给“降预算/暂停”动作加 GMV 约束：近 3 天 GMV 相对大盘/对照明显走弱时，优先只观察；
- 给“加预算”动作加更严格的趋势条件，减少 reduce→increase 的误判；
- 扩大样本到 50–100 个 T0，按类目/投放方式分层看；
- 把同一套 case 接到 LLM Agent 上，比较“规则 vs Agent”的方向准确率与护栏通过率。

## 6. 说明

- 这是历史回放：只给 T0 前数据，T+7 只用于事后标签。
- 对照是 T0 时相似的计划/账户，不是随机 A/B；结论是“事后相对表现”，不是严格因果。
- 学习期按 `learningStartedAt` 还原；当前状态为已暂停的计划，在 T0 有消耗时仍按投放中处理。
- 样本不足（转化 <20/天 或 消耗 <3,000/7d）时，事后标签按“只观察”处理，和产品行为一致。
- 护栏用“相对对照组的 GMV 变化”判断，避免把大盘下跌误判成 Agent 的锅。
