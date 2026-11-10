# 面试讲解手册：GETmore 多专家投放工作台

> 目标：让面试官在 3–5 分钟内听懂“你做了什么、为什么这么做、怎么验证”。
> 不接真实千川 API；项目重点是**架构、决策闭环和评测**，不是线上投放结果。

---

## 1. 一句话版本

> 我做了一个面向直播电商投放的多专家 Agent 工作台：三个专家共享上下文、按技能分工，所有写操作先变成待确认 Decision，再用 T+7 回放、rubric 和 pass@3 做评测。

---

## 2. 30 秒讲法

1. **问题**：投手看多个账户/计划，预算、库存、退款、素材都要判断；单个 Agent 容易既当分析又当执行，越权且不可解释。
2. **做法**：拆成机会洞察、数据分析、广告投放三个专家；技能做成 `SKILL.md` 包，planner 选技能、专家按需加载；工具统一成 connector，经本地 MCP 调用。
3. **安全**：专家只提交待确认 Decision，人工确认后才生效，可审计、可撤销。
4. **验证**：60 个 T+7 回放、20 个 rubric、6 个技能 pass@3、76 个计划预测一致性。

---

## 3. 架构图（白板可画）

```text
用户目标
  ↓
Planner（拆专家 + 选技能）
  ↓
┌─────────────┬─────────────┬─────────────┐
│ 机会洞察     │ 数据分析     │ 广告投放     │
│ 3 connector │ 5 connector │ 8 connector │
│ 0 skill     │ 6 skill     │ 5 skill     │
└─────────────┴─────────────┴─────────────┘
  ↓ 需要完整方法时 load_skill
SKILL.md（agent/skills/<id>/）
  ↓
callConnector
  ↓
mcp-client → mcp-server（stdio JSON-RPC）
  ↓
executeTool（16 个业务工具）
  ↓
读：查询结果   写：待确认 Decision
  ↓
人工确认 → 操作生效 → 审计/撤销
```

---

## 4. 四个可讲的技术点

### 4.1 多专家：不是“一个 prompt 换三个名字”

- 每个专家有独立 L2/L3 上下文、独立工具白名单、独立成功标准；
- 机会洞察只读，数据分析只诊断，广告投放才能提交写动作；
- 专家之间通过共享 L1 和 synthesis 汇总，不互相污染上下文。

### 4.2 技能：WorkBuddy 风格

- 技能是目录包：`SKILL.md` 方法正文 + `skill.json` 元数据；
- planner 先看摘要选 0–2 个技能；
- 专家 prompt 只放摘要，需要完整步骤时调用 `load_skill`；
- planner 没选到就回退关键词 router，保证确定性测试；
- `load_skill` 校验 `expertIds`，机会洞察不能加载投放技能。

### 4.3 工具：connector + 本地 MCP

- 16 个业务工具统一成 connector：风险 `read/write/destructive`、专家绑定、mock 授权状态；
- 运行时 `callConnector → mcp-client → mcp-server tools/call`；
- MCP 用 stdio JSON-RPC，暴露 `tools/list` / `tools/call`；
- spawn 失败自动回退进程内，保证 demo 不挂；
- 写工具仍然只生成待确认 Decision。

### 4.4 安全与评测

- 5 条执行护栏：幅度、余额、品牌预算、库存、数据缺口；
- 写操作 HITL：提案 → 确认/拒绝 → 审计 → 撤销；
- 评测：60 个 T+7 回放、20 个 rubric、6 个技能 live/pass@3、76 个计划预测自洽；
- 评测结论要讲边界：mock 数据证明“方法和稳定性”，不证明真实市场增量。

---

## 5. Demo 流程（5 分钟）

1. 打开工作台，先看到三个模块入口；进入「专家团队」，展示三个专家和 16 个 connector 的绑定；
2. 返回首页，从 Copilot 输入框选「深度执行」进入协作任务；
3. 输入“库存只剩 3 天，计划还要不要投”；
4. 展示 planner 选技能、专家 `load_skill`、MCP 工具调用；
5. 展示待确认 Decision：暂停/降预算，不直接执行；
6. 确认后展示操作记录、审计、撤销；
7. 打开评测页，讲 60 回放 / 20 rubric / pass@3。

---

## 6. 面试官可能问

### Q1：为什么不做一个 Agent？

> 一个 Agent 也能做，但职责边界会糊：分析、决策、执行混在一起，出错不可定位。拆专家是为了**权限隔离 + 上下文隔离 + 可评测**，不是为了“多而多”。

### Q2：Skill 和 Tool 有什么区别？

> Skill 是“怎么做”的方法（判断顺序、阈值、失败处理）；Tool 是“能做什么”的执行能力（查数、暂停、调预算）。Skill 不执行代码，只影响模型怎么选工具。

### Q3：为什么用 MCP？

> 把工具调用从“进程内函数”变成标准协议，后面接真实外部系统时，专家/编排不用改；现在用本地 MCP Server 做适配层，没接千川 API。

### Q4：怎么证明有效？

> 分三层：方法有效性（T+7 回放）、回答质量（rubric）、稳定性（pass@3）。但 mock 数据不能证明真实市场增量；真实效果需要 shadow/canary/A-B。

### Q5：关键词 router 是不是太简单？

> 主路径已经是 planner 选技能，关键词 router 只是兜底；保留它是因为确定性、可测试，planner 失败时 demo 不会崩。

### Q6：这些数据是真的吗？

> 不是，是确定性 mock 数据；项目重点是架构、决策闭环和评测方法，不宣称真实投放收益。

---

## 7. 不要过度声称

- 不说“提升了真实 ROI”；
- 不说“预测准确率 90%”；
- 不说“完全自动投放”；
- 不说“接入了千川”；
- 说清楚：**mock 数据、HITL、可回退、评测有边界**。

---

## 8. 可展示的文件

- 技能包：`agent/skills/inventory_stop_loss/SKILL.md`
- 专家包：`agent/experts/ads.json`
- 编排：`server/orchestrator.mjs`
- Connector：`server/connectors.mjs`
- MCP：`server/mcp-server.mjs` / `server/mcp-client.mjs`
- 评测：`docs/eval/llm-rubric.report.md`、`docs/eval/report.md`
- 架构：`docs/partner-architecture.md`

## 9. 可跑的命令

```bash
pnpm qa:experts
pnpm qa:connectors
pnpm qa:mcp
pnpm qa:skill:files
pnpm qa:skill:agent:inventory
pnpm qa:capability
```
