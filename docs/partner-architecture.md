# 巨量伙伴：提交待确认动作的多专家 Agent 团队

> 一句话：**GETmore 工作台里的一个团队层**——一个编排者 + 三个专家 + 一套共享上下文 + 一套可撤销的操作审计。
>
> 它不是"给建议的聊天机器人"：广告投放专家会查数、分工、提交预算 / 暂停 / 出价提案；优化师确认后才作用于模拟账户，并同步到「数据」看板。所有写操作都有护栏、审计和一键撤销。

---

## 0. 产品位置：伙伴团队属于工作台，而不是并列 Tab

```text
GETmore 工作台（一级）
├─ 统一输入框   默认对话；打开「深度执行」交给伙伴团队
├─ 伙伴团队     多专家执行（本文档）
└─ 工作痕迹     运行记录 / 工具轨迹 / 反馈（抽屉，按需打开）
数据（一级）
```

设计原则：

- **一个入口**：用户不需要先选"对话还是 Agent"；同一个输入框，按需切换深度执行。
- **工作与复盘分离**：用户平时在工作台里下目标、看结果、撤销动作；"巨量伙伴"不是另一个产品首页，而是团队名册与工作痕迹。
- **伙伴是能力，不是入口**：三个专家是工作台的能力层；用户不需要先理解"多 Agent"才能用。
- **痕迹按需打开**：运行历史收进「工作痕迹」抽屉，避免占据主工作区。
- 当前版本只保留优化师视角与用户反馈；Badcase 评测后续单独做，不在本版界面暴露。

---

## 1. 为什么不是"多个各自为战的 Agent"

共享上下文不能靠"每个 Agent 自己维护一份"，那样目标和口径一定会漂移。这里的分工是：

- **编排者拥有唯一的共享上下文 L1**（目标、阶段、大盘、记忆），专家只读。
- **专家不写共享状态**：只产出结论，或通过受控工具执行动作。
- **专家不拥有长期记忆**：记忆是全局资产，按任务检索后注入 L1。
- **动作只有一个写入口**：`apply_budget_change / pause_plan / resume_plan / adjust_bid`，统一护栏、审计、撤销。

```text
                 ┌──────────────────────────────────┐
                 │ 巨量伙伴 Orchestrator             │
                 │ 意图理解 · 选专家 · 装配 L1        │
                 │ 收敛决策 · 写回记忆                │
                 └───────────────┬──────────────────┘
                                 │ L1（共享只读）
      ┌──────────────────────────┼──────────────────────────┐
      ▼                          ▼                          ▼
 机会洞察（只读）            数据分析（只读）            广告投放（可执行）
 趋势 / 人群 / 机会          账户 / 计划 / 组织          预算 / 暂停 / 出价
      │                          │                          │
      └──────────── 专家结论 ─────┴──────── 操作事件 ────────┘
                                 │
                 ┌───────────────▼──────────────────┐
                 │ 决策 memo + 待确认动作 + 可撤销审计 │
                 │ 记忆写回：决策 / 预期 / 偏好        │
                 └──────────────────────────────────┘
```

## 2. 一个专家 = 五件东西

| 层 | 实现 | 位置 |
| --- | --- | --- |
| ① 角色 Prompt | 身份、判断标准、输出结构、越权边界 | `server/orchestrator.mjs` 的 `expertPrompt()` |
| ② 工具集 | 每个专家独立白名单，广告投放才可写 | `server/tools.mjs` |
| ③ 上下文切片 | L1 共享 + L2 领域 + L3 任务，硬 token 预算 | `buildL1 / buildL2 / buildL3` |
| ④ 评估标准 | 每个专家独立的"干得好"定义 | `EXPERTS[].success` |
| ⑤ 记忆 | 决策 / 偏好 / 结果验证 | `server/memory.mjs` |

Prompt 只占 20%；工具边界、上下文切片和记忆验证才是产品壁垒。

## 3. 分层上下文（共享 vs 裁剪）

| 层 | 内容 | 预算 | 可见性 |
| --- | --- | --- | --- |
| **L1 全局** | 日期、阶段、北极星目标、大盘、风险、历史决策/偏好 | ≤ 620 tokens | 所有专家共享只读 |
| **L2 领域** | 机会：类目/人群/机会；分析：口径/维度/环比；投放：预算/余额/护栏 | 每位 ≤ 460 | 仅该专家 |
| **L3 任务** | 本次目标、分工、成功标准、输出边界 | 每位 ≤ 280 | 仅该专家 |

实现：字符近似 token（`chars × 0.72`），`fitBudget` 按行裁剪；实际 tokens / 预算 / 是否裁剪会在前端「上下文」中展示，超出即截断。

## 4. 一次任务的生命周期

1. **规划**：JSON-mode 调用产出 `intent / experts / successCriteria / assumptions`。
   代码层强制覆盖：涉及预算/出价/暂停 → 必须同时有 `analytics + ads`；涉及增长 → 补 `opportunity`；最多 3 个专家。
2. **装配**：构建 L1，按专家构建 L2/L3。
3. **并行**：专家并行，每人最多 5 轮（投放）/ 4 轮（只读）工具调用。
4. **执行**：投放专家在护栏内直接写操作，`operation_applied` 实时推给前端，并落 `.runtime/partner/operations.json`。
5. **收敛**：读取本轮待确认动作，流式生成决策 memo（结论 / 依据 / 待确认方案 / 风险与回滚）。
6. **写回**：决策 + 预期 + 偏好写回记忆；动作可撤销，记忆可回看验证。

SSE 事件：

```text
run_start → context_l1 → plan → context(L2/L3) → expert_start*
→ tool_call* → tool_result* → operation_applied*
→ expert_end* → synthesis_start → delta*
→ memory_write → run_end
```

## 5. 三个专家包与 16 个 connector

专家配置在 `agent/experts/<id>.json`，不再写死在代码里：

```json
{
  "id": "ads",
  "name": "广告投放",
  "persona": "你负责把诊断变成可审批的投放动作……",
  "skillIds": ["learning_phase_diagnosis", "budget_reallocation", "..."],
  "connectorIds": ["get_budget_pacing", "get_account_plans", "forecast_plan", "..."]
}
```

`tools.mjs` 按 `connectorIds` 组装每个专家的工具：没绑定的工具不会出现在它的 Schema 里。三个专家当前是：

| 专家 | connector | skill | 读写 |
| --- | --- | --- | --- |
| 机会洞察 | 3 | 0 | 只读 |
| 数据分析 | 5 | 6 | 只读 |
| 广告投放 | 8 | 5 | 可提交 Decision |

### 5.1 机会洞察（只读）

**成功定义**：机会 3–7 天内可被数据验证，能落到账户/人群/预算。

| 工具 | 关键参数 | 返回 |
| --- | --- | --- |
| `get_market_trends` | `category`, `days?` | 热度、增长、竞品动作、竞价区间 |
| `get_audience_segments` | `category` | 人群规模、TGI、增量评分、活跃时段 |
| `find_opportunities` | `channel?`, `scope?` | 机会列表：类型、账户、证据、预期、置信度、机会分 |

### 5.2 数据分析（只读）

**成功定义**：结论可下钻、口径与看板一致。

| 工具 | 关键参数 | 返回 |
| --- | --- | --- |
| `query_accounts` | `channel?`, `org?`, `search?`, `sort_by?`, `order?`, `limit?`, `min_cost?`, `min_roi?`, `max_roi?`, `range?` | 账户明细 + 聚合 |
| `query_plans` | `account_id?`, `status?`, `mode?`, `sort_by?`, `order?`, `limit?`, `range?` | 计划明细 |
| `get_account_trend` | `account_id`, `days?` | 日序列 + 汇总 |
| `compare_periods` | `account_id?`, `range?` | 当前 vs 上周期 |
| `get_org_summary` | `org_id?` | 子组织：账户数/消耗/支付/ROI/CPA/余额 |

### 5.3 广告投放（提交审批）

**成功定义**：动作有依据、先由优化师确认、确认后可审计可撤销。

| 工具 | 关键参数 | 结果 |
| --- | --- | --- |
| `get_budget_pacing` | `account_id` | 无 |
| `get_account_plans` | `account_id`, `status?`, `limit?` | 无 |
| `forecast_plan` | `plan_id`, `horizon_days?`（3–7） | 无（预测区间 + 建议 + 验证点 + 回滚） |
| `load_skill` | `skill_id` | 技能完整正文（元工具，只读；只允许加载 `expertIds` 包含自己的技能） |
| `simulate_budget_change` | `account_id`, `delta_pct` | 无（仅预测） |
| `apply_budget_change` | `account_id`, `delta_pct: ±20`, `reason` | **生成待确认 Decision** |
| `pause_plan` | `plan_id`, `reason` | **生成待确认 Decision** |
| `resume_plan` | `plan_id`, `reason` | **生成待确认 Decision** |
| `adjust_bid` | `plan_id`, `delta_pct: ±15`, `reason` | **生成待确认 Decision** |

### 5.4 技能包与渐进加载（WorkBuddy 风格）

技能现在放在 `agent/skills/<id>/`：

```text
agent/skills/<id>/
├── SKILL.md     # 方法正文：触发 / 步骤 / 输出 / 护栏 / 失败处理
└── skill.json   # 元数据：expertIds、toolNames、steps、output、eval case
```

调用链：

1. planner 拿到 6 个技能的摘要（名称/描述/触发/绑定），最多选 2 个；
2. 专家 prompt 只注入选中技能的摘要，不注入全文；
3. 专家需要完整步骤/阈值时调用 `load_skill`；
4. 没选到或选错 → 回退关键词路由（`skill-router.mjs`）；
5. `load_skill` 会校验 `expertIds`，机会洞察不能加载只给 analytics/ads 的技能。

技能只提供方法，不直接执行动作；写操作仍然走工具 + 人工确认。

### 5.5 Connector 适配层

16 个业务工具现在统一注册为 connector（`server/connectors.mjs`）：

| 字段 | 含义 |
| --- | --- |
| `id` / `name` / `description` | connector 标识、显示名、说明 |
| `risk` | `read` / `write` / `destructive` |
| `requiresApproval` | 写动作是否必须人工确认 |
| `expertIds` / `expertNames` | 哪些专家可以调用 |
| `auth` | 演示环境为 `mock/connected`；接真实 OAuth 时替换 |
| `enabled` | 是否启用 |

运行时 `runExpert` 不再直接 `executeTool`，而是：

```text
专家 → callConnector(expertId, connectorId, args, ctx)
     → 校验 connector 是否存在/启用/专家有权限
     → mcp-client（stdio JSON-RPC）
     → mcp-server tools/call
     → executeTool（当前进程内 handler）
     → 返回结果
```

- `mcp-server.mjs` 暴露 16 个 tools（`tools/list`）；
- `tools/call` 通过 `_meta` 接收 `expertId / runId / range / requestedTargets`；
- MCP spawn 失败时自动回退到进程内 `executeTool`；
- `MCP_MODE=off` 可强制关闭 MCP。

写工具仍然只生成待确认 Decision；connector 层只负责“能不能调、谁可以调、风险是什么”。

写工具不再直接调用 `applyOperation()`，而是：

1. 做护栏校验（幅度 / 预测 ROI / 余额 / 品牌预算）；
2. 生成 `Decision`（pending，30 分钟有效）；
3. 推送 `decision_created`；
4. 优化师在运行详情或左侧「待确认动作」中确认；
5. `POST /partner/decisions/:id/approve` 才调用 `applyOperation()`；
6. 操作进入审计，可撤销。

> 项目只面向优化师：没有主管/双人审批。高风险动作要求勾选业务确认，确认人就是优化师本人。它防的是 Agent 误操作，不是内部权限舞弊。

## 6. 护栏与权限

| 规则 | 值 |
| --- | --- |
| 预算调整 | 单次 ≤ ±20% |
| 出价调整 | 单次 ≤ ±15% |
| 预测 ROI | ≥ 2.5（低于则拒绝提交） |
| 余额 | < 1,000 元不提交，先充值 |
| 单任务动作数 | ≤ 3 |
| 品牌预算 | 直接拦截（需品牌团队复核） |
| 优化师确认 | 所有写动作必须确认；30 分钟过期 |
| 高风险动作 | 必须勾选“已核对库存/预算/计划范围” |
| 动作记录 | before/after/理由/预期/run_id/时间，全部落盘 |

只读专家没有写工具；写工具只注册在广告投放专家上，工具名即权限边界。

## 7. 记忆：写回 + 结果验证

每次任务写回：

1. **决策**：`intent + 综合结论第一段`。
2. **预期**：来自第一条待确认动作（预测 ROI / 增量支付）。
3. **偏好**：从目标里抽取的硬约束（如"ROI 不低于 3.5"）。

检索评分：关键词 bigram + 作用域 + 时间衰减 + 已验证加权，Top 6 注入 L1。

「回看」时生成模拟 T+3 结果，写入 `actual` 与 `verdict`（correct / partial / wrong）；验证正确的记忆在后续检索中加权，错误的降权。没有结果验证的记忆只是聊天记录。

## 8. 评估

| 层级 | 指标 |
| --- | --- |
| 单专家 | 工具成功率、结论采纳、证据完整度 |
| 任务 | 完成率、动作执行数、撤销率、耗时、tokens |
| 业务 | 3 天后 ROI/CPA 是否守住，增量支付是否兑现 |
| 记忆 | 命中率、验证准确率 |
| 用户反馈 | 反馈数、分类分布、动作/数据引用问题占比 |

当前版本只保留优化师视角与「我的反馈」；Badcase 标记与评测统计后续单独做，不在本版界面暴露。用户仍可点开运行查看工具轨迹、上下文、决策与动作审计。

## 9. 工程实现

```text
server/
├─ index.mjs          HTTP + SSE（:5180）
├─ orchestrator.mjs   规划 / 上下文 / 专家并行 / 合成 / 记忆
├─ tools.mjs          16 个工具、白名单、护栏\n├─ decisions.mjs      Human-in-the-loop 提案 / 确认 / 拒绝 / 过期
├─ operations.mjs     操作记录、decorateMock、撤销
├─ data-service.mjs   查询服务（与前端同一份 mock 数据）
├─ memory.mjs         记忆检索 / 写回 / 回看
├─ runs.mjs           任务历史
├─ llm.mjs            DeepSeek chat / stream / tools
└─ mock.mjs           esbuild 打包 src/data/mock.ts
```

关键接口：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/partner/run` | 启动任务，SSE 返回 trace |
| GET | `/partner/runs` / `/runs/:id` | 任务历史 / 详情 |
| GET | `/partner/operations` | 当前生效的操作（前端看板同步） |
| GET | `/partner/decisions` | 待确认 / 已确认 / 已拒绝动作 |\n| POST | `/partner/decisions/:id/approve` | 优化师确认，调用 applyOperation 并写审计 |\n| POST | `/partner/decisions/:id/reject` | 优化师拒绝，不执行 |\n| POST | `/partner/operations/:id/undo` | 撤销操作，看板回滚 |
| GET | `/partner/memory` | 记忆列表与统计 |
| POST | `/partner/memory/verify` | 模拟 T+3 回看 |
| POST | `/partner/runs/:id/badcase` | 标记 Badcase 或用户反馈（body 含 `source`） |
| DELETE | `/partner/runs/:id/badcase` | 清除标记 / 撤回反馈 |
| GET | `/partner/experts` | 工具 Schema（前端「工具」弹窗） |
| GET | `/partner/health` | 模型 / 记忆 / 护栏状态 |

前端 `PartnerView` 通过 SSE 渲染：计划、上下文、专家卡片（工具轨迹）、决策、待确认动作（确认/拒绝）、已执行操作（撤销）、记忆；「工作痕迹」抽屉负责运行筛选、工具轨迹回看与优化师反馈；Badcase 标记接口保留，但本版界面不暴露，后续评测单独做。工作台输入框通过 `startPartnerTask` 把「深度执行」目标交给伙伴团队，自动切换并开跑；`WorkbenchContext` 同时保存操作列表与待执行目标，数据看板把操作叠加到账户/计划上并显示「Agent」标记。

## 10. 生产化取舍

- **执行安全**：写工具只生成 Decision；优化师确认后才 applyOperation；高风险动作需要勾选业务确认；生产和幂等键/回滚已作为下一步。
- **工作流**：当前是单请求长任务；生产改队列 + checkpoint + 重试。
- **上下文**：字符估算 → 真 tokenizer；L2 改检索式知识片段。
- **记忆**：关键词检索 → embedding；模拟回看 → 平台真实 T+3 指标。
- **权限**：单用户 → RBAC/租户隔离/密钥托管；当前只暴露优化师视角，生产应由 SSO 角色下发；Badcase 写权限后续评测单独做。
- **评估**：加离线评测集（目标 → 期望工具路径/动作）与线上 A/B。

## 11. 演示路径

1. 打开 GETmore 工作台，在输入框打开「深度执行」开关。
2. 输入目标："把 ROI 低于 3.5 的计划停掉，把 ROI 高于 4.5 的账户预算加 20%，最差计划出价下调 10%。"回车。
3. 自动进入伙伴团队并开跑；看执行计划与专家并行的工具轨迹。
4. 在「待优化师确认」中查看预算 11,000→11,990、出价 65→58.5，确认后进入「已执行操作」，点撤销立即回滚。
5. 切到「数据」：顶部显示 Agent 最近操作，相关账户带 Agent 标记，预算/状态已变化。
6. 打开「工具」：16 个工具 Schema 与读写权限。
7. 打开「工作痕迹」：按工具失败 / 有操作 / 已撤销筛选，点开运行看工具轨迹、上下文和动作审计。
8. 对某次运行提交反馈（结果不对 / 数据引用错误 / 动作不对 / 太慢 / 其他）。
9. Badcase 标记与评测统计后续单独做，本版界面不暴露。
10. 打开「记忆」：决策/偏好/结果验证。
