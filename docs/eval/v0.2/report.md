# 策略实验 · 历史回放评测 v0.2

> 生成时间：2026/11/5 12:29:42 ｜ 样本：60 个 T0

## 1. 结论

- 规则动作方向准确率：**61.7%**（95% bootstrap CI 50.0%–73.3%）
- 动作方向 + 护栏都通过：**53.3%**
- baseline（永远只观察）：63.3%
- baseline（永远降预算）：26.7%
- 预测校准 MAE：0.28（42 条可校准）
- 真正执行动作：31 个；通过 GMV 护栏：16 个；违规：15 个

> 读法：方向准确率只看“该不该动”；真正执行动作的 31 个里只有 16 个通过 GMV 护栏。说明规则“方向大致对，但动作偏多/偏重”。

## 2. 事后标签分布

| 事后标签 | 数量 |
| --- | --- |
| 只观察 | 38 |
| 降预算/收缩 | 16 |
| 加预算/放量 | 6 |

## 3. 分模板

| 模板 | 样本 | 方向准确率 | 安全准确率 | 护栏通过/动作数 |
| --- | --- | --- | --- | --- |
| 学习期（learning_phase） | 21 | 100.0% | 90.5% | 0/2 |
| 预算撞线（budget_cap） | 8 | 12.5% | 12.5% | 1/8 |
| 低 ROI 高消耗（low_roi_high_spend） | 21 | 66.7% | 52.4% | 8/11 |
| 高 ROI 低消耗（high_roi_low_spend） | 10 | 10.0% | 10.0% | 7/10 |

## 4. 混淆矩阵

| 事后标签 → 建议动作 | 数量 |
| --- | --- |
| reduce->reduce | 6 |
| observe->observe | 29 |
| increase->increase | 2 |
| reduce->increase | 10 |
| observe->increase | 6 |
| increase->reduce | 4 |
| observe->reduce | 3 |

## 5. 校准与阈值敏感性

| 预测 ROI 区间 | 样本 | MAE |
| --- | --- | --- |
| < 3.5 | 23 | 0.24 |
| 3.5–3.8 | 11 | 0.35 |
| ≥ 3.8 | 8 | 0.28 |

| 阈值配置 | 方向准确率 | 安全准确率 | 护栏通过/动作数 |
| --- | --- | --- | --- |
| baseline (did 0.2 / GMV -8%) | 61.7% | 53.3% | 16/31 |
| 更严格 did 0.3 | 58.3% | 50.0% | 16/31 |
| 更宽松 GMV -10% | 61.7% | 53.3% | 16/31 |
| 护栏放宽到 -10% | 61.7% | 53.3% | 18/31 |

## 6. Badcase 分类

| 类型 | 数量 | 含义 |
| --- | --- | --- |
| missed_action | 0 | 该动但只观察 |
| over_action | 9 | 不该动但建议动作 |
| wrong_direction | 14 | 方向反了 |
| guardrail_fail | 5 | 方向对但 GMV 护栏破 |

| case | 范围 | 建议 | 事后标签 | 原因 |
| --- | --- | --- | --- | --- |
| 2026-10-29-rec_learning_phase_1739810000031676 | 标准-纯棉四件套-晚场直播冲刺 · 轻氧家居旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-28-rec_budget_cap_1723560000016063 | 潮玩星球旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD 0.05，GMV 相对 -15.2%） |
| 2026-10-28-rec_learning_phase_1739810000031676 | 标准-纯棉四件套-晚场直播冲刺 · 轻氧家居旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-26-rec_budget_cap_1723560000002385 | 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD 0.13，GMV 相对 -34.7%） |
| 2026-10-26-rec_high_roi_low_spend_1739810000015838 | 标准-羊毛混纺大衣-商品卡推广 · 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.27，GMV 相对 -6.3%） |
| 2026-10-25-rec_budget_cap_1723560000002385 | 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.44，GMV 相对 -33.5%） |
| 2026-10-25-rec_budget_cap_1723560000018017 | 沐野运动旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD 0.04，GMV 相对 -32.0%） |
| 2026-10-25-rec_high_roi_low_spend_1739810000015838 | 标准-羊毛混纺大衣-商品卡推广 · 拾光服饰旗舰店 | increase | observe | 建议 increase，事后标签 observe（DiD 0.10，GMV 相对 0.2%） |
| 2026-10-25-rec_high_roi_low_spend_1739810000017064 | 全域-高腰直筒牛仔裤-晚场直播冲刺 · 拾光服饰旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.61，GMV 相对 -50.2%） |
| 2026-10-24-rec_high_roi_low_spend_1739810000015838 | 标准-羊毛混纺大衣-商品卡推广 · 拾光服饰旗舰店 | increase | observe | 建议 increase，事后标签 observe（DiD 0.12，GMV 相对 11.2%） |
| 2026-10-23-rec_low_roi_high_spend_1739810000142542 | 标准-轻量徒步鞋-短视频带货 · 沐野运动旗舰店 | reduce | reduce | 护栏违规 |
| 2026-10-22-rec_budget_cap_1723560000006293 | 初见美妆旗舰店 | increase | reduce | 建议 increase，事后标签 reduce（DiD -0.70，GMV 相对 -18.5%） |

## 7. 下一步

- 给“降预算/暂停”动作加 GMV 约束：近 3 天 GMV 相对对照明显走弱时，优先只观察；
- 给“加预算”动作加更严格的趋势条件，减少 reduce→increase 的误判；
- 保持 60 个 case 不变，做 v0.3 规则对比，避免样本变化混淆结论；
- 把同一套 case 接到 LLM Agent 上，比较“规则 vs Agent”的方向准确率与护栏通过率。

## 8. 说明

- 这是历史回放：只给 T0 前数据，T+7 只用于事后标签。
- 对照是 T0 时相似的计划/账户，不是随机 A/B；结论是“事后相对表现”，不是严格因果。
- 学习期按 `learningStartedAt` 还原；T0 有消耗的计划按“投放中”处理。
- 样本不足（转化 <20/天 或 消耗 <3,000/7d）时，事后标签按“只观察”处理，和产品行为一致。
- 护栏用“相对对照组的 GMV 变化”判断，避免把大盘下跌误判成 Agent 的锅。
