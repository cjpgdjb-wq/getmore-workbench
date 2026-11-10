# Skill Router：什么时候触发，不再靠模型自觉

> 2026-11 起主路径改成 WorkBuddy 风格：**planner 先看技能摘要选 0–2 个 → 专家拿摘要 → 需要时 `load_skill` 读全文**。  
> 本文件保留的 `skill-router.mjs` 是**兜底**：planner 没给、给错或为空时，按关键词选 1 个主技能。

---

## 1. 为什么保留确定性路由

只有模型选技能会有三个问题：

- 同一个目标，模型可能这次用、下次不用；
- 六个技能全注入，模型可能串用；
- 面试官问“什么时候触发”，只能回答“模型判断”。

所以主路径用 planner 选，**fallback 用 `server/skill-router.mjs`**，规则写死、可测试。

---

## 2. 兜底规则与优先级

兜底时每个任务最多选 **1 个主技能**，按优先级匹配：

| 优先级 | 技能 | 触发词（示例） |
| --- | --- | --- |
| 100 | 周报复盘 | 周报、本周复盘、只读复盘 |
| 90 | 库存止损 | 库存、断货、售罄、没货 |
| 80 | 退款异常 | 退款、净成交、仅退款 |
| 70 | 素材拒审 | 拒审、素材审核、没有可投素材 |
| 60 | 学习期诊断 | 学习期、冷启动 |
| 50 | 预算重排 | 预算怎么分/挪/重排、整体 ROI 低 |

规则顺序就是优先级。  
例如“退款率 22%，要不要降预算”会命中退款，而不是预算重排。

没有命中：

```text
不注入任何技能
→ 专家使用基础 prompt
→ 不硬套技能
```

---

## 3. 代码路径

```text
runPartner(goal)
→ ensureCoverage（周报/只读会移除 ads）
→ planner 看到技能摘要，输出 skills（0–2 个）
→ 选中技能只注入摘要（skillSummaryBlock）
→ 专家需要时 load_skill(skill_id) 读全文
→ planner 没给/给错/为空 → routeSkills(goal) 兜底
→ plan.skills / skill_route 事件可审计
```

关键点：

- 技能包在 `agent/skills/<id>/SKILL.md`，`skill.json` 存元数据；
- 摘要只给名称/描述/触发，不给步骤；
- `load_skill` 校验 `expertIds`，机会洞察不能加载只给 analytics/ads 的技能；
- 路由结果通过 `skill_route` 事件发出，可审计。

---

## 4. 示例

| 目标 | 路由结果 | 注入 |
| --- | --- | --- |
| 诊断学习期计划还要不要降预算 | `learning_phase_diagnosis` | analytics + ads 的学习期技能 |
| 把低 ROI 的预算挪到高 ROI | `budget_reallocation` | analytics + ads 的预算重排 |
| 库存只剩 3 天，还要不要投 | `inventory_stop_loss` | analytics + ads 的库存止损 |
| 退款率 22%，要不要降预算 | `refund_anomaly` | analytics + ads 的退款异常 |
| 素材被拒审，计划还在消耗 | `creative_reject_guard` | analytics + ads 的素材拒审 |
| 写本周投放周报 | `weekly_review` | 只给 analytics 的周报 |
| 今天天气怎么样 | 无 | 基础 prompt |

---

## 5. 评测

`npm run qa:router` 覆盖：

- 6 个技能的正向触发；
- 1 个不相关目标不触发；
- 只注入选中技能（周报不会带学习期）；
- ads 没有周报技能时返回空。

结果：

```text
learning_phase_diagnosis <- 诊断学习期计划还要不要降预算
budget_reallocation <- 把低 ROI 的预算挪到高 ROI 账户
inventory_stop_loss <- 库存只剩 3 天，计划还要不要投
refund_anomaly <- 退款率 22%，要不要降预算
creative_reject_guard <- 素材被拒审，计划还在消耗
weekly_review <- 写本周投放周报
none <- 今天天气怎么样
Skill router check passed
```

---

## 6. 边界

- 当前是**文本规则**，还不是“数据条件路由”；
- 一个任务只选 1 个主技能，不支持多技能组合；
- 关键词可能重叠，靠优先级解决；
- 真正的数据条件（退款率 >15%、库存 ≤3 天）在技能内部判断，不在 router 里重复；
- 下一步可以把 router 升级成“文本 + 数据条件”的路由，但先保持简单可测。

---

## 7. 面试一句话

> 技能触发不是靠模型自觉：我先用确定性 router 按目标选技能，只把选中的技能注入对应专家；没命中就不注入。这样“什么时候触发”是可解释、可测试的。
