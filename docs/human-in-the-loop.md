# Human-in-the-loop（优化师确认）

## 1. 定位

项目只面向优化师，因此这里不做“主管审批流”，而做**优化师确认层**：

```text
Agent 提交提案
  → 待优化师确认
  → 确认 / 修改后确认 / 拒绝
  → 执行
  → 回执
  → 可撤销
```

没有第二个角色。价值是：

- 防止 Agent 误操作；
- 补充库存、活动、客户意图等业务上下文；
- 让优化师修改 AI 的建议；
- 留下“谁确认、何时确认、为什么确认”的审计；
- 执行后决定保留或回滚。

## 2. 状态机

```text
pending
  ├─ approved → operation → undo
  ├─ rejected
  └─ expired（30 分钟）
```

服务端状态：

```ts
Decision {
  id
  runId
  workspaceId
  tool
  action
  targetType
  targetId
  targetName
  field
  before
  after
  unit
  reason
  evidence[]
  dataGaps[]
  expected
  riskLevel: "low" | "medium" | "high"
  riskText
  status
  requestedBy: "agent"
  createdAt
  expiresAt
  decidedBy: "优化师"
  decidedAt
  comment
  operationId
}
```

**Agent 只能创建 Decision，不能直接调用写操作。**

## 3. 确认入口

### 对话运行内

伙伴团队跑完后，运行详情出现「待优化师确认」卡片：

- 目标、字段、before / after；
- 数据依据；
- 风险级别；
- 数据缺口；
- 预期影响；
- 查看并确认。

### 全局待确认入口

左侧「待确认动作」显示所有 pending 提案；点开可以跨运行处理。

## 4. 风险分级与交互摩擦

| 风险 | 例子 | 交互 |
| --- | --- | --- |
| 低 | 恢复计划、下调预算 | 一次确认 |
| 中 | 上调预算 ≤10%、调出价 ≤15% | 看 diff + 确认 |
| 高 | 预算接近 ±20%、单计划占账户消耗 >50% | 必须勾选“已核对库存/预算/计划范围” |

高风险未勾选时，「确认并执行」禁用。

## 5. 服务端校验

确认接口不是“点一下直接改”：

1. Decision 必须是 `pending`；
2. 未过期；
3. 目标属于当前 run / workspace；
4. 幅度仍在护栏内；
5. 单次任务最多 3 个动作；
6. 写操作幂等，重复确认不会重复执行；
7. 写入 `operations` 审计，保留 before / after / 理由 / 预期；
8. 可由同一个优化师撤销。

## 6. 只面向优化师的边界

- 没有主管、双签、审批队列；
- 确认人就是优化师本人；
- 因此它防的是**Agent 误操作**，不是**内部权限舞弊**；
- 高风险动作通过“勾选业务确认 + 备注”增加摩擦，而不是增加第二个人；
- 如果未来接入主管/品牌团队，再扩展 `requiredRole` / 多级审批，不改 Decision 主体。

## 7. API

```text
GET  /partner/decisions?status=pending&runId=...
GET  /partner/decisions/:id
POST /partner/decisions/:id/approve
POST /partner/decisions/:id/reject
```

确认后返回 `decision + operation`；操作进入 `GET /partner/operations`，前端可撤销。

## 8. 演示路径

1. 伙伴团队输入：
   “账户 1723560000004339（轻氧家居旗舰店）日预算从 11000 提高到 12000，+9%，请提交审批，不要直接执行。”
2. 专家调用 `apply_budget_change`，只生成 Decision；
3. 运行详情出现「待优化师确认」；
4. 点「查看并确认」；
5. 中风险：直接确认；高风险：勾选业务确认；
6. 确认后写入操作审计，数据看板同步；
7. 「已执行操作」中可撤销；
8. 也可以点「拒绝」，不会产生任何写操作。

## 9. 当前边界

- 已覆盖预算、出价、暂停/恢复；
- 商品工作区支持预算/出价/暂停/恢复提案；新建/复刻计划仍不支持；
- 工作区级 `allowedPlanIds` 的服务端校验还没接；
- Decision 过期后需重新提交；
- 备注为可选，高风险通过勾选而不是强制文字。

## 10. 商品工作区里的触发规则

商品工作区的 HITL 不是“每轮回答都弹确认”，而是：

```text
用户有明确执行意图
  + 规划器能落到具体账户/计划/动作
  = 生成执行提案
```

### 会出现 HITL 的情况

| 情况 | 例子 | 处理 |
| --- | --- | --- |
| 用户明确要求执行 | “按你的规划执行” | 生成动作提案 |
| 预算调整 | 加/降账户日预算 | 提案 + diff |
| 出价调整 | 上调/下调计划出价 | 提案 + diff |
| 暂停 / 恢复计划 | 停掉低效计划 | 提案 |
| 库存不足时加预算 | 库存 0.4 天仍要加量 | 高风险，必须勾选确认 |
| 数据缺失 | 补货时间未知、授权缺失 | 列入数据缺口 |
| 超出支持范围 | 新建/复刻计划 | 不生成假动作，提示人工 |
| 跨商品 / 跨账户 | 让当前工作区操作其他商品 | 拒绝，提示新建工作区 |

### 不会出现 HITL 的情况

- 问“为什么 ROI 掉了”；
- 问“预算怎么调”但没有执行指令；
- 查询账户/计划；
- 模拟预算影响；
- 只读分析、复盘、建议；
- 切换看板视图。

### 工具层应该怎么挂

理想实现是工具元数据驱动：

```ts
Tool {
  risk: "read" | "write" | "destructive"
  requiresConfirmation: boolean
  scope: "workspace"
}
```

执行器在调用写工具前：

```text
read      → 直接执行
write     → 创建 Decision，等待确认
destructive → Decision + 高风险确认
```

当前商品工作区还没有接入 Nanobot 的自定义工具调用，所以先用一个**工作区执行规划器**：

```text
POST /partner/workspace/propose
```

它根据：

- 当前商品 / 账户 / 计划；
- 用户消息；
- 上一轮助手方案；
- 库存、ROI、余额、护栏；

生成 `Decision`；不会直接写。确认后走同一套
`/partner/decisions/:id/approve` 与商品级范围校验。

> 这是过渡层。下一步把提案逻辑移进工具执行器，就能做到“任何写工具调用自动 HITL”，而不是靠消息触发。

## 11. 一句话

> Agent 负责提案，优化师负责确认；没有第二个角色，但每一次花钱都必须有人点头。
