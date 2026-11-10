import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Database,
  Flag,
  FlaskConical,
  History,
  Loader2,
  Megaphone,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Telescope,
  Undo2,
  Wrench,
  Zap,
} from "lucide-react";
import { Checkbox, Modal, useToast } from "../../components/ui";
import { DateRangePopover } from "../data/DataModals";
import { useWorkbench } from "../../state/workbench";
import ExperimentDrawer from "./ExperimentDrawer";
import CapabilityCenterModal from "./CapabilityCenterModal";
import HypothesisModal from "./HypothesisModal";
import {
  approveDecision,
  clearBadcase,
  getDecisions,
  getExpertCatalog,
  getCapabilitySkills,
  getCapabilityTools,
  getHealth,
  getMemory,
  getRun,
  getRuns,
  rejectDecision,
  streamPartnerRun,
  tagBadcase,
  undoOperation,
  verifyMemory,
  type AdDecision,
  type AdOperation,
  type Badcase,
  type CapabilitySkill,
  type CapabilityTool,
  type ContextLayer,
  type ExpertCatalogItem,
  type MemoryEntry,
  type PartnerEvent,
  type PartnerHealth,
  type PartnerPlan,
  type PartnerRunSummary,
  type ToolTrace,
} from "../../lib/partner";

/* ------------------------------------------------------------------ */
/* Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface UiTool extends ToolTrace {
  pending?: boolean;
}

interface UiExpert {
  id: string;
  name: string;
  role: string;
  color: string;
  canWrite: boolean;
  focus: string;
  status: "queued" | "running" | "done" | "error";
  finding: string;
  tools: UiTool[];
  latencyMs?: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface UiRun {
  id: string;
  goal: string;
  status: "running" | "done" | "error";
  startedAt: number;
  range?: { start: string; end: string };
  plan?: PartnerPlan;
  layers: ContextLayer[];
  memoryHits: { id: string; kind: string; text: string; score: number }[];
  experts: Record<string, UiExpert>;
  expertOrder: string[];
  synthesis: string;
  operations: AdOperation[];
  memories: MemoryEntry[];
  execution?: { mode: string; label: string };
  badcase?: Badcase | null;
  latencyMs?: number;
  notices: string[];
  error?: string;
}

const EXPERT_ICONS: Record<string, typeof Compass> = {
  opportunity: Telescope,
  analytics: BarChart3,
  ads: Megaphone,
};

const EXPERT_TONES: Record<string, string> = {
  opportunity: "green",
  analytics: "blue",
  ads: "orange",
};

const STAGES = ["理解", "装配", "执行", "决策", "完成"];

const EXAMPLES = [
  {
    icon: BarChart3,
    title: "预算重排",
    goal: "把 ROI 低于 3.5 的计划停掉，预算加到 ROI 高于 4.5 且余额充足的账户，控制整体 ROI 不低于 3.5。",
  },
  {
    icon: Compass,
    title: "找增量",
    goal: "女装和食品类目还有哪些增长机会？直接在现有账户里执行一个可以在 7 天内验证的测试。",
  },
  {
    icon: Sparkles,
    title: "异常止损",
    goal: "找出最近 7 天消耗异常、ROI 掉队的账户和计划，直接暂停最差的计划并给出复盘。",
  },
];

function estimate(text: string): number {
  return Math.ceil(text.length * 0.72);
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function fieldLabel(field: AdOperation["field"]): string {
  if (field === "budget") return "日预算";
  if (field === "bid") return "出价";
  return "状态";
}

function formatOperationValue(operation: Pick<AdOperation, "field" | "unit">, value: string | number): string {
  if (operation.field === "status") return String(value);
  return `${money(Number(value))} ${operation.unit || ""}`.trim();
}

function MarkdownView({ text }: { text: string }) {
  return (
    <div className="agent-content pt-md">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                       */
/* ------------------------------------------------------------------ */

function TokenBar({ value, max }: { value: number; max: number }) {
  const percent = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <span className="pt-tokenbar" title={`${value} / ${max} tokens`}>
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

function LayerRow({ layer, open, onToggle }: { layer: ContextLayer; open: boolean; onToggle: () => void }) {
  return (
    <div className={`pt-layer ${open ? "is-open" : ""}`}>
      <button type="button" className="pt-layer-head" onClick={onToggle}>
        <span className={`pt-layer-key pt-layer-${layer.key.toLowerCase()}`}>{layer.key}</span>
        <span className="pt-layer-label">{layer.label}</span>
        {layer.trimmed && <span className="tag tag-gray">已裁剪</span>}
        <span className="pt-layer-tokens">
          {layer.tokens}t
          <TokenBar value={layer.tokens} max={layer.budget} />
        </span>
        <ChevronDown size={12} className={`pt-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && <pre className="pt-layer-body">{layer.content}</pre>}
    </div>
  );
}

function ExpertCard({ expert }: { expert: UiExpert }) {
  const Icon = EXPERT_ICONS[expert.id] ?? Sparkles;
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const statusLabel =
    expert.status === "running" ? "执行中" : expert.status === "done" ? "已完成" : expert.status === "error" ? "失败" : "排队中";

  return (
    <section className={`pt-expert tone-${EXPERT_TONES[expert.id] ?? "blue"} is-${expert.status}`}>
      <header className="pt-expert-head">
        <span className="pt-expert-icon">
          <Icon size={16} />
        </span>
        <div className="pt-expert-title">
          <div>
            {expert.name}
            <span className="pt-expert-role">{expert.role}</span>
          </div>
          <div className="pt-expert-focus">{expert.focus || "等待分工"}</div>
        </div>
        <span className={`pt-expert-status is-${expert.status}`}>
          {expert.status === "running" ? <Loader2 size={11} className="spin" /> : expert.status === "done" ? <Check size={11} /> : null}
          {statusLabel}
        </span>
      </header>

      {expert.tools.length > 0 && (
        <div className="pt-tool-list">
          <div className="pt-tool-list-head">
            工具 <span>{expert.tools.length}</span>
          </div>
          {expert.tools.map((tool) => (
            <div className={`pt-tool ${tool.ok ? "ok" : "fail"} ${tool.pending ? "pending" : ""}`} key={tool.id}>
              <button
                type="button"
                className="pt-tool-row"
                onClick={() => setExpandedTool((prev) => (prev === tool.id ? null : tool.id))}
              >
                <span className="pt-tool-dot" />
                <span className="pt-tool-name">{tool.label}</span>
                <span className="pt-tool-summary">{tool.pending ? "执行中…" : tool.summary}</span>
                <span className="pt-tool-time">{tool.durationMs ? `${tool.durationMs}ms` : ""}</span>
              </button>
              {expandedTool === tool.id && <pre className="pt-tool-args">{JSON.stringify(tool.args, null, 2)}</pre>}
            </div>
          ))}
        </div>
      )}

      {expert.finding && (
        <div className="pt-expert-finding">
          <MarkdownView text={expert.finding} />
        </div>
      )}

      {expert.status === "running" && !expert.finding && (
        <div className="pt-expert-thinking">
          <Loader2 size={13} className="spin" />
          正在查数与决策
          <span className="dots"><span /><span /><span /></span>
        </div>
      )}

      <footer className="pt-expert-foot">
        {expert.canWrite ? <span className="tag tag-orange">提交审批</span> : <span className="tag tag-outline">只读</span>}
        <span className="spacer" />
        {expert.latencyMs ? <span className="pt-meta"><Clock size={10} /> {(expert.latencyMs / 1000).toFixed(1)}s</span> : null}
        {expert.usage?.completion_tokens ? <span className="pt-meta">{expert.usage.completion_tokens} tokens</span> : null}
      </footer>
    </section>
  );
}

function OperationRow({ operation, onUndo }: { operation: AdOperation; onUndo: (operation: AdOperation) => void }) {
  return (
    <div className={`pt-operation ${operation.undone ? "is-undone" : ""}`}>
      <span className="pt-op-icon">
        {operation.field === "status" ? <Zap size={13} /> : <RefreshCw size={13} />}
      </span>
      <div className="pt-op-main">
        <div className="pt-op-title">
          {operation.target_name}
          <span className="tag tag-outline">{fieldLabel(operation.field)}</span>
        </div>
        <div className="pt-op-change">
          {formatOperationValue(operation, operation.before)}
          <span className="pt-op-arrow">→</span>
          <b>{formatOperationValue(operation, operation.after)}</b>
        </div>
        <div className="pt-op-reason">{operation.reason}</div>
      </div>
      <div className="pt-op-side">
        <span className="pt-meta">{timeLabel(operation.at)}</span>
        {operation.undone ? (
          <span className="badge badge-gray">已撤销</span>
        ) : (
          <button type="button" className="btn btn-default btn-sm" onClick={() => onUndo(operation)}>
            <Undo2 size={12} /> 撤销
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionRow({ decision, onReview }: { decision: AdDecision; onReview: (decision: AdDecision) => void }) {
  const riskLabel = decision.riskLevel === "high" ? "高风险" : decision.riskLevel === "medium" ? "中风险" : "低风险";
  const pending = decision.status === "pending";
  return (
    <div className={`pt-decision risk-${decision.riskLevel} is-${decision.status}`}>
      <span className={`pt-decision-icon ${pending ? "is-pending" : "is-done"}`}>
        {pending ? <ShieldCheck size={15} /> : <Check size={15} />}
      </span>
      <div className="pt-decision-main">
        <div className="pt-decision-title">
          {decision.targetName}
          <span className="tag tag-outline">{fieldLabel(decision.field)}</span>
          <span className={`pt-risk ${decision.riskLevel}`}>{riskLabel}</span>
          {!pending && (
            <span className={`badge ${decision.status === "approved" ? "badge-green" : "badge-gray"}`}>
              {decision.status === "approved" ? "已确认" : decision.status === "rejected" ? "已拒绝" : "已过期"}
            </span>
          )}
        </div>
        <div className="pt-op-change">
          {formatOperationValue(decision, decision.before)}
          <span className="pt-op-arrow">→</span>
          <b>{formatOperationValue(decision, decision.after)}</b>
        </div>
        <div className="pt-op-reason">{decision.reason}</div>
        {decision.evidence.length > 0 && (
          <div className="pt-decision-evidence">
            {decision.evidence.slice(0, 3).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        )}
        {decision.dataGaps.length > 0 && (
          <div className="pt-decision-gap">
            <AlertTriangle size={11} /> 数据缺口：{decision.dataGaps.join("；")}
          </div>
        )}
      </div>
      <div className="pt-decision-side">
        <span className="pt-meta">{timeLabel(decision.createdAt)}</span>
        {pending ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onReview(decision)}>
            查看并确认
          </button>
        ) : (
          <span className="pt-meta">{decision.decidedBy ?? "优化师"} · {decision.decidedAt ? timeLabel(decision.decidedAt) : ""}</span>
        )}
      </div>
    </div>
  );
}

function DecisionReviewModal({
  decision,
  busy,
  onClose,
  onApprove,
  onReject,
}: {
  decision: AdDecision | null;
  busy: boolean;
  onClose: () => void;
  onApprove: (decision: AdDecision, comment: string) => void;
  onReject: (decision: AdDecision, comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const [ack, setAck] = useState(false);
  useEffect(() => {
    setComment("");
    setAck(false);
  }, [decision?.id]);
  if (!decision) return null;
  const highRisk = decision.riskLevel === "high";
  return (
    <Modal
      open={Boolean(decision)}
      onClose={onClose}
      title="确认投放动作"
      desc="Agent 只提交提案；确认后才会执行并写入审计，可撤销。"
      className="decision-review-modal"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>取消</button>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onReject(decision, comment)}
            disabled={busy}
          >
            拒绝
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApprove(decision, comment)}
            disabled={busy || (highRisk && !ack)}
          >
            {busy ? <Loader2 size={12} className="spin" /> : <Check size={12} />} 确认并执行
          </button>
        </>
      }
    >
      <div className="decision-review-target">{decision.targetName}</div>
      {decision.experimentId && (
        <div className="decision-experiment">
          <FlaskConical size={13} />
          <div>
            <b>来自 GetMore 规划</b>
            <span>确认后才开始计时；执行后可在工作痕迹里复盘和回滚。</span>
          </div>
        </div>
      )}
      <div className="decision-review-change">
        <span>{formatOperationValue(decision, decision.before)}</span>
        <b>→ {formatOperationValue(decision, decision.after)}</b>
      </div>
      <div className={`decision-risk ${decision.riskLevel}`}>
        <AlertTriangle size={13} />
        <div>
          <b>{decision.riskLevel === "high" ? "高风险动作" : decision.riskLevel === "medium" ? "中风险动作" : "低风险动作"}</b>
          <p>{decision.riskText || "请在确认前核对数据与计划范围。"}</p>
        </div>
      </div>
      <div className="decision-detail-block">
        <b>调整理由</b>
        <p>{decision.reason}</p>
      </div>
      {decision.evidence.length > 0 && (
        <div className="decision-detail-block">
          <b>数据依据</b>
          <ul>{decision.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {decision.expected?.text && (
        <div className="decision-detail-block">
          <b>预期影响</b>
          <p>{decision.expected.text}</p>
        </div>
      )}
      {decision.dataGaps.length > 0 && (
        <div className="decision-detail-block is-warn">
          <b>数据缺口</b>
          <p>{decision.dataGaps.join("；")}</p>
        </div>
      )}
      {highRisk && (
        <label className="decision-ack">
          <Checkbox checked={ack} onChange={setAck} ariaLabel="确认已核对高风险动作" />
          <span>我已核对库存、预算和计划范围，确认执行</span>
        </label>
      )}
      <label className="decision-comment">
        <span>备注（可选）</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="例如：已确认 3 天内补货"
          rows={2}
        />
      </label>
      <div className="decision-expiry">提案 30 分钟内有效；执行后可在「已执行操作」中撤销。</div>
    </Modal>
  );
}

function MemoryRow({ entry, onVerify }: { entry: MemoryEntry; onVerify: (entry: MemoryEntry) => void }) {
  const kindLabel = entry.kind === "decision" ? "决策" : entry.kind === "preference" ? "偏好" : "结果";
  return (
    <div className="pt-memory-row">
      <span className={`pt-memory-kind is-${entry.kind}`}>{kindLabel}</span>
      <div className="pt-memory-main">
        <div className="pt-memory-text">{entry.text}</div>
        {entry.actual?.text && <div className="pt-memory-actual">{entry.actual.text}</div>}
      </div>
      {entry.status === "verified" ? (
        <span className={`badge ${entry.verdict === "correct" ? "badge-green" : entry.verdict === "wrong" ? "badge-red" : "badge-orange"}`}>
          {entry.verdict === "correct" ? "验证正确" : entry.verdict === "wrong" ? "判断偏差" : "部分正确"}
        </span>
      ) : (
        <button type="button" className="btn btn-default btn-sm" onClick={() => onVerify(entry)}>
          <RefreshCw size={11} /> 回看
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modals                                                             */
/* ------------------------------------------------------------------ */

function ToolsModal({ open, onClose, experts }: { open: boolean; onClose: () => void; experts: ExpertCatalogItem[] }) {
  return (
    <Modal open={open} onClose={onClose} title="专家与工具" desc="只读专家只查数据；广告投放专家提交待确认动作，优化师确认后才执行" className="pt-tools-modal">
      <div className="pt-tools-grid">
        {experts.map((expert) => {
          const Icon = EXPERT_ICONS[expert.id] ?? Sparkles;
          return (
            <section key={expert.id} className={`pt-tools-expert tone-${EXPERT_TONES[expert.id] ?? "blue"}`}>
              <header>
                <span className="pt-expert-icon"><Icon size={15} /></span>
                <div>
                  <div className="pt-tools-name">{expert.name}</div>
                  <div className="pt-tools-role">{expert.role}</div>
                </div>
                <span className={`badge ${expert.canWrite ? "badge-orange" : "badge-blue"}`}>
                  {expert.canWrite ? "提交审批" : "只读"}
                </span>
              </header>
              <p className="pt-tools-success">{expert.success}</p>
              {expert.skills.length > 0 && (
                <div className="pt-expert-skills">
                  {expert.skills.map((skill) => (
                    <span key={skill.id} title={skill.description}>
                      技能 · {skill.name} v{skill.version}
                    </span>
                  ))}
                </div>
              )}
              <div className="pt-tool-defs">
                {expert.tools.map((tool) => {
                  const properties = (tool.parameters?.properties ?? {}) as Record<
                    string,
                    { type?: string; description?: string; enum?: string[] }
                  >;
                  const required = Array.isArray(tool.parameters?.required) ? (tool.parameters.required as string[]) : [];
                  return (
                    <div key={tool.name} className="pt-tool-def">
                      <code>{tool.name}</code>
                      <p>{tool.description}</p>
                      {Object.keys(properties).length > 0 && (
                        <div className="pt-tool-params">
                          {Object.entries(properties).map(([name, schema]) => (
                            <div key={name} className="pt-tool-param">
                              <span className="pt-param-name">
                                {name}
                                {required.includes(name) && <i>*</i>}
                              </span>
                              <span className="pt-param-type">{schema.enum ? schema.enum.join(" | ") : schema.type ?? "any"}</span>
                              <span className="pt-param-desc">{schema.description}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

function MemoryModal({
  open,
  onClose,
  entries,
  stats,
  onVerify,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  entries: MemoryEntry[];
  stats: PartnerHealth["memory"] | null;
  onVerify: (entry: MemoryEntry) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "decision" | "preference" | "outcome">("all");
  const list = entries.filter((entry) => filter === "all" || entry.kind === filter);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="专属记忆"
      desc={`${stats?.total ?? entries.length} 条 · 待验证 ${stats?.pending ?? 0} · 准确率 ${stats?.accuracy ?? "--"}%`}
      className="pt-memory-modal"
    >
      <div className="pt-memory-toolbar">
        {[
          { key: "all", label: "全部" },
          { key: "decision", label: "决策" },
          { key: "preference", label: "偏好" },
          { key: "outcome", label: "结果" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pt-filter-chip ${filter === item.key ? "is-active" : ""}`}
            onClick={() => setFilter(item.key as typeof filter)}
          >
            {item.label}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="text-action" onClick={onRefresh}>
          <RefreshCw size={12} /> 刷新
        </button>
      </div>
      <div className="pt-memory-list">
        {list.map((entry) => (
          <MemoryRow key={entry.id} entry={entry} onVerify={onVerify} />
        ))}
        {list.length === 0 && <div className="pt-empty-small">还没有记忆，执行一次任务后自动写回。</div>}
      </div>
      <p className="pt-memory-note">决策 / 预期 / 偏好会在下次任务前被检索；点「回看」补上结果，记忆才算验证。</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Traces & Badcase                                                   */
/* ------------------------------------------------------------------ */

const PM_BADCASE_CATEGORIES = ["结论错误", "动作错误", "工具失败", "上下文缺失", "编造事实", "延迟过高", "其他"];
const USER_FEEDBACK_CATEGORIES = ["结果不对", "数据引用错误", "动作不对", "太慢", "其他"];

type TraceFilter = "all" | "badcase" | "feedback" | "failed" | "action" | "undone";

const PM_FILTERS: { key: TraceFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "badcase", label: "Badcase" },
  { key: "failed", label: "工具失败" },
  { key: "action", label: "有操作" },
  { key: "undone", label: "已撤销" },
];

const USER_FILTERS: { key: TraceFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "feedback", label: "已反馈" },
  { key: "action", label: "有操作" },
];

function TraceDrawer({
  open,
  onClose,
  onBack,
  runs,
  catalog,
  isPm,
  onOpen,
  onTag,
}: {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  runs: PartnerRunSummary[];
  catalog: ExpertCatalogItem[];
  isPm: boolean;
  onOpen: (id: string) => void;
  onTag: (id: string) => void;
}) {
  const [filter, setFilter] = useState<TraceFilter>("all");
  const expertName = (id: string) => catalog.find((item) => item.id === id)?.name ?? id;
  const toolCalls = runs.reduce((sum, run) => sum + run.toolCallCount, 0);
  const toolFailures = runs.reduce((sum, run) => sum + run.toolFailureCount, 0);
  const badcases = runs.filter((run) => run.badcase && run.badcase.source !== "user").length;
  const feedbacks = runs.filter((run) => run.badcase?.source === "user").length;
  const operations = runs.reduce((sum, run) => sum + run.operationCount, 0);
  const failureRate = toolCalls > 0 ? Math.round((toolFailures / toolCalls) * 100) : 0;
  const filters = isPm ? PM_FILTERS : USER_FILTERS;

  const filtered = runs.filter((run) => {
    if (filter === "badcase") return Boolean(run.badcase) && run.badcase?.source !== "user";
    if (filter === "feedback") return run.badcase?.source === "user";
    if (filter === "failed") return run.toolFailureCount > 0;
    if (filter === "action") return run.operationCount > 0;
    if (filter === "undone") return run.undoneCount > 0;
    return true;
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      onBack={onBack}
      title="工作痕迹"
      desc={
        isPm
          ? "团队运行记录 · 查看每个伙伴做了什么，也用于产品经理复盘 Badcase"
          : "团队运行记录 · 查看每个伙伴做了什么，遇到问题可提交反馈"
      }
      className="pt-trace-modal"
    >
      <div className="pt-trace-stats">
        <div><span>运行</span><b>{runs.length}</b></div>
        <div>
          <span>{isPm ? "Badcase" : "我的反馈"}</span>
          <b className={isPm && badcases ? "is-warn" : ""}>{isPm ? badcases : feedbacks}</b>
        </div>
        <div><span>工具失败率</span><b>{failureRate}%</b></div>
        <div><span>已执行动作</span><b>{operations}</b></div>
      </div>

      <div className="pt-memory-toolbar">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pt-filter-chip ${filter === item.key ? "is-active" : ""}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="pt-trace-list">
        {filtered.map((run) => (
          <div
            key={run.id}
            className="pt-trace-row"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(run.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(run.id);
            }}
          >
            <span className={`pt-trace-dot is-${run.status}`} />
            <div className="pt-trace-main">
              <div className="pt-trace-goal">{run.goal}</div>
              <div className="pt-trace-meta">
                <span>{timeLabel(run.createdAt)}</span>
                <span>{run.experts.map(expertName).join(" + ") || "未分工"}</span>
                <span>{run.operationCount} 个动作{run.pendingDecisionCount > 0 ? ` · ${run.pendingDecisionCount} 待确认` : ""}</span>
                <span>{run.latencyMs ? `${(run.latencyMs / 1000).toFixed(1)}s` : "--"}</span>
                <span>{run.toolCallCount} 次工具</span>
              </div>
            </div>
            <div className="pt-trace-tags">
              {run.badcase && (isPm || run.badcase.source === "user") && (
                <span className={`badge ${run.badcase.source === "user" ? "badge-blue" : "badge-red"}`}>
                  {run.badcase.source === "user" ? "已反馈" : run.badcase.category}
                </span>
              )}
              {!isPm && run.badcase && run.badcase.source !== "user" && (
                <span className="tag tag-gray">已处理</span>
              )}
              {run.toolFailureCount > 0 && <span className="tag tag-orange">{run.toolFailureCount} 工具失败</span>}
              {run.undoneCount > 0 && <span className="tag tag-gray">{run.undoneCount} 已撤销</span>}
            </div>
            {(isPm || !run.badcase || run.badcase.source === "user") && (
              <button
                type="button"
                className="btn-link pt-trace-flag"
                onClick={(event) => {
                  event.stopPropagation();
                  onTag(run.id);
                }}
              >
                <Flag size={11} />{" "}
                {isPm ? (run.badcase ? "更新" : "标记") : run.badcase?.source === "user" ? "更新" : "反馈"}
              </button>
            )}
            <ArrowUpRight size={12} className="pt-trace-open" />
          </div>
        ))}
        {filtered.length === 0 && <div className="pt-empty-small">没有符合筛选条件的运行。</div>}
      </div>

      <p className="pt-memory-note">
        {isPm
          ? "产品经理视角：点开任一运行可看专家工具调用、上下文、决策与动作审计；工具失败、撤销、Badcase 会在这里自动汇总，便于定位是模型、上下文还是工具的问题。"
          : "点开任一运行可查看工具轨迹与执行结果；如果结论或动作不对，提交反馈后产品经理会在工作痕迹中复盘。"}
      </p>
    </Modal>
  );
}

function BadcaseModal({
  open,
  run,
  mode,
  onClose,
  onSubmit,
  onClear,
}: {
  open: boolean;
  run: PartnerRunSummary | null;
  mode: "pm" | "user";
  onClose: () => void;
  onSubmit: (id: string, category: string, note: string) => void;
  onClear: (id: string) => void;
}) {
  const categories = mode === "pm" ? PM_BADCASE_CATEGORIES : USER_FEEDBACK_CATEGORIES;
  const [category, setCategory] = useState(categories[0]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    const existing = run?.badcase?.category;
    setCategory(existing && categories.includes(existing) ? existing : categories[0]);
    setNote(run?.badcase?.note ?? "");
    // categories 由 mode 决定，随 mode / run 变化重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run?.id, run?.badcase?.category, run?.badcase?.note, mode]);

  if (!run) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "pm" ? "标记 Badcase" : "反馈问题"}
      desc={run.goal}
      className="pt-badcase-modal"
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose}>取消</button>
          <span className="spacer" />
          {run.badcase && (
            <button type="button" className="btn btn-ghost" onClick={() => onClear(run.id)}>
              {mode === "pm" ? "清除标记" : "撤回反馈"}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onSubmit(run.id, category, note)}>
            {mode === "pm" ? "保存" : "提交反馈"}
          </button>
        </>
      }
    >
      <div className="pt-badcase-form">
        <label className="pt-field-label">问题分类</label>
        <div className="pt-badcase-cats">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`pt-filter-chip ${category === item ? "is-active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="pt-field-label" htmlFor="badcase-note">
          {mode === "pm" ? "复盘备注" : "问题描述"}
        </label>
        <textarea
          id="badcase-note"
          rows={5}
          value={note}
          placeholder={
            mode === "pm"
              ? "例如：把品牌预定单的 ROI=0 误判为低效计划，导致错误暂停建议；希望专家先区分口径。"
              : "例如：结论引用的是昨天的数据；或动作不该暂停这个计划。"
          }
          onChange={(event) => setNote(event.target.value)}
        />
        {run.badcase && (
          <div className="pt-badcase-existing">
            <Flag size={11} />{" "}
            {run.badcase.source === "user"
              ? `已反馈为「${run.badcase.category}」`
              : `已标记为「${run.badcase.category}」`}{" "}
            · {timeLabel(run.badcase.at)}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                          */
/* ------------------------------------------------------------------ */

export default function PartnerView() {
  const toast = useToast();
  const {
    snapshot,
    setSnapshot,
    setActiveTab,
    activeTab,
    operations,
    addOperation,
    refreshOperations,
    partnerGoal,
    consumePartnerGoal,
    role,
  } = useWorkbench();

  const [health, setHealth] = useState<PartnerHealth | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ExpertCatalogItem[]>([]);
  const [activeModule, setActiveModule] = useState<"home" | "experts" | "team">("home");
  const [activeExpertId, setActiveExpertId] = useState("opportunity");
  const [skillDetail, setSkillDetail] = useState<CapabilitySkill | null>(null);
  const [toolDetail, setToolDetail] = useState<CapabilityTool | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [memoryStats, setMemoryStats] = useState<PartnerHealth["memory"] | null>(null);
  const [runs, setRuns] = useState<PartnerRunSummary[]>([]);
  const [run, setRun] = useState<UiRun | null>(null);
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [badcaseId, setBadcaseId] = useState<string | null>(null);
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [decisions, setDecisions] = useState<AdDecision[]>([]);
  const [pendingAll, setPendingAll] = useState<AdDecision[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<AdDecision | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const operationsRef = useRef<HTMLElement>(null);
  const stickRef = useRef(true);

  const view = useMemo(
    () => ({
      channel: snapshot?.channel ?? "auction",
      dimensionLabel: snapshot?.dimensionLabel ?? "账户",
      range: snapshot?.range ?? undefined,
      orgName: snapshot?.orgName ?? null,
      search: snapshot?.search ?? "",
    }),
    [snapshot],
  );

  const refreshMemory = useCallback(async () => {
    try {
      const data = await getMemory();
      setMemory(data.entries);
      setMemoryStats(data.stats);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const data = await getRuns();
      setRuns(data.runs);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshDecisions = useCallback(async (runId?: string | null) => {
    if (!runId) {
      setDecisions([]);
      return [] as AdDecision[];
    }
    try {
      const data = await getDecisions({ runId });
      setDecisions(data.decisions);
      return data.decisions;
    } catch {
      return [] as AdDecision[];
    }
  }, []);

  const refreshPendingAll = useCallback(async () => {
    try {
      const data = await getDecisions({ status: "pending" });
      setPendingAll(data.decisions);
      return data.decisions;
    } catch {
      return [] as AdDecision[];
    }
  }, []);

  useEffect(() => {
    void refreshPendingAll();
  }, [refreshPendingAll]);

  useEffect(() => {
    if (activeTab === "partner") void refreshPendingAll();
  }, [activeTab, refreshPendingAll]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const healthData = await getHealth();
        if (!alive) return;
        setHealth(healthData);
        setHealthError(null);
      } catch (error) {
        if (!alive) return;
        setHealthError(error instanceof Error ? error.message : "编排服务未连接");
      }
      try {
        const catalogData = await getExpertCatalog();
        if (alive) setCatalog(catalogData.experts);
      } catch {
        /* ignore */
      }
      await refreshMemory();
      await refreshRuns();
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [refreshMemory, refreshRuns]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (run?.status === "running" && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [run?.synthesis, run?.status, run?.experts]);

  useEffect(() => {
    if (run?.status !== "done") return;
    const element = scrollRef.current;
    if (element) element.scrollTop = 0;
    stickRef.current = true;
  }, [run?.status]);

  const applyEvent = useCallback(
    (event: PartnerEvent) => {
      setRun((prev) => {
        if (!prev) return prev;
        const next: UiRun = {
          ...prev,
          experts: { ...prev.experts },
          layers: [...prev.layers],
          operations: [...prev.operations],
          memories: [...prev.memories],
          notices: [...prev.notices],
        };
        switch (event.type) {
          case "run_start":
            next.id = String(event.runId ?? prev.id);
            runIdRef.current = next.id;
            next.range = (event.range as UiRun["range"]) ?? prev.range;
            next.execution = event.execution as UiRun["execution"];
            break;
          case "context_l1": {
            const layer = event.layer as ContextLayer;
            next.layers = [layer, ...next.layers.filter((item) => item.key !== "L1")];
            next.memoryHits = Array.isArray(event.memoryHits) ? (event.memoryHits as UiRun["memoryHits"]) : [];
            break;
          }
          case "plan":
            next.plan = event.plan as PartnerPlan;
            break;
          case "context": {
            const layers = Array.isArray(event.layers) ? (event.layers as ContextLayer[]) : [];
            next.layers = [...next.layers.filter((item) => item.key === "L1"), ...layers];
            break;
          }
          case "expert_start": {
            const expert = event.expert as { id: string; name: string; role: string; color: string; canWrite: boolean };
            next.experts[expert.id] = {
              ...expert,
              focus: String(event.focus ?? ""),
              status: "running",
              finding: "",
              tools: [],
            };
            if (!next.expertOrder.includes(expert.id)) next.expertOrder = [...next.expertOrder, expert.id];
            break;
          }
          case "tool_call": {
            const expertId = String(event.expertId ?? "");
            const expert = next.experts[expertId];
            if (expert) {
              next.experts[expertId] = {
                ...expert,
                tools: [
                  ...expert.tools,
                  {
                    id: String(event.id ?? ""),
                    tool: String(event.tool ?? ""),
                    label: String(event.label ?? event.tool ?? ""),
                    args: (event.args as Record<string, unknown>) ?? {},
                    ok: true,
                    summary: "执行中…",
                    durationMs: 0,
                    pending: true,
                  },
                ],
              };
            }
            break;
          }
          case "tool_result": {
            const expertId = String(event.expertId ?? "");
            const expert = next.experts[expertId];
            if (expert) {
              next.experts[expertId] = {
                ...expert,
                tools: expert.tools.map((tool) =>
                  tool.id === event.id
                    ? {
                        ...tool,
                        ok: Boolean(event.ok),
                        summary: String(event.summary ?? ""),
                        durationMs: Number(event.durationMs ?? 0),
                        pending: false,
                      }
                    : tool,
                ),
              };
            }
            break;
          }
          case "expert_end": {
            const expertId = String(event.expertId ?? "");
            const expert = next.experts[expertId];
            if (expert) {
              next.experts[expertId] = {
                ...expert,
                status: event.error ? "error" : "done",
                finding: String(event.finding ?? ""),
                tools: Array.isArray(event.tools) ? (event.tools as ToolTrace[]) : expert.tools,
                latencyMs: Number(event.latencyMs ?? 0) || undefined,
                usage: (event.usage as UiExpert["usage"]) ?? undefined,
              };
            }
            break;
          }
          case "expert_error": {
            const expertId = String(event.expertId ?? "");
            const expert = next.experts[expertId];
            if (expert) next.experts[expertId] = { ...expert, status: "error", finding: String(event.message ?? "执行失败") };
            break;
          }
          case "operation_applied": {
            const operation = event.operation as AdOperation;
            if (operation && !next.operations.some((item) => item.id === operation.id)) {
              next.operations = [...next.operations, operation];
            }
            break;
          }
          case "delta":
            next.synthesis = `${next.synthesis}${String(event.text ?? "")}`;
            break;
          case "memory_write":
            next.memories = [...next.memories, ...((event.entries as MemoryEntry[]) ?? [])];
            break;
          case "run_end":
            next.status = "done";
            next.latencyMs = Number(event.latencyMs ?? 0) || undefined;
            break;
          case "error":
            next.error = String(event.message ?? "执行失败");
            break;
          case "notice":
            next.notices = [...next.notices, String(event.message ?? "")];
            break;
          default:
            break;
        }
        return next;
      });

      if (event.type === "operation_applied" && event.operation) {
        addOperation(event.operation as AdOperation);
      }
      if (event.type === "decision_created" && event.decision) {
        const decision = event.decision as AdDecision;
        setDecisions((prev) =>
          prev.some((item) => item.id === decision.id) ? prev : [decision, ...prev],
        );
        if (decision.status === "pending") {
          setPendingAll((prev) =>
            prev.some((item) => item.id === decision.id) ? prev : [decision, ...prev],
          );
        }
      }
    },
    [addOperation],
  );

  const startRun = async (text?: string) => {
    const value = (text ?? goal).trim();
    if (!value) {
      toast("先描述一个目标", "warn");
      return;
    }
    if (running) return;
    setActiveModule("team");
    setGoal(value);
    setRunning(true);
    setDecisions([]);
    setReviewDecision(null);
    runIdRef.current = null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRun({
      id: "pending",
      goal: value,
      status: "running",
      startedAt: Date.now(),
      layers: [],
      memoryHits: [],
      experts: {},
      expertOrder: [],
      synthesis: "",
      operations: [],
      memories: [],
      badcase: null,
      notices: [],
    });
    try {
      await streamPartnerRun({ goal: value, view, signal: controller.signal, onEvent: applyEvent });
      await refreshRuns();
      await refreshMemory();
      await refreshOperations();
      const latest = await refreshDecisions(runIdRef.current);
      await refreshPendingAll();
      const pending = latest.filter((decision) => decision.status === "pending").length;
      toast(
        pending > 0 ? `任务完成，${pending} 个动作等待你确认` : "任务完成，没有待确认动作",
        pending > 0 ? "info" : "success",
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setRun((prev) => (prev ? { ...prev, status: "error", error: "已停止" } : prev));
      } else {
        const message = error instanceof Error ? error.message : "任务执行失败";
        setRun((prev) => (prev ? { ...prev, status: "error", error: message } : prev));
        toast(message, "warn");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  // 统一入口：工作台输入框选择「深度执行」后，切到伙伴团队并自动开跑。
  useEffect(() => {
    if (!partnerGoal || running) return;
    const goal = consumePartnerGoal();
    if (!goal) return;
    setActiveModule("team");
    setGoal(goal);
    void startRun(goal);
    // startRun 在每次渲染重建；这里只由 partnerGoal 驱动，避免循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerGoal, running, consumePartnerGoal]);

  const openRun = async (id: string) => {
    if (running) return;
    try {
      const data = await getRun(id);
      const detail = data.run;
      const experts: Record<string, UiExpert> = {};
      const order: string[] = [];
      for (const expert of detail.experts) {
        const catalogItem = catalog.find((item) => item.id === expert.id);
        experts[expert.id] = {
          id: expert.id,
          name: expert.name,
          role: expert.role,
          color: "#2b6bff",
          canWrite: catalogItem?.canWrite ?? expert.id === "ads",
          focus: expert.focus,
          status: expert.error ? "error" : "done",
          finding: expert.finding,
          tools: expert.tools,
          latencyMs: expert.latencyMs,
          usage: expert.usage,
        };
        order.push(expert.id);
      }
      const l1Layer: ContextLayer = {
        key: "L1",
        label: "全局经营上下文",
        tokens: estimate(detail.context.l1),
        budget: 620,
        preview: detail.context.l1.slice(0, 180),
        content: detail.context.l1,
      };
      const liveOperations = new Map(operations.map((operation) => [operation.id, operation]));
      const mergedOperations = [
        ...(detail.operations ?? []).map((operation) => liveOperations.get(operation.id) ?? operation),
        ...operations.filter(
          (operation) =>
            operation.run_id === detail.id &&
            !(detail.operations ?? []).some((item) => item.id === operation.id),
        ),
      ];
      setRun({
        id: detail.id,
        goal: detail.goal,
        status: "done",
        startedAt: detail.createdAt,
        range: detail.range,
        plan: detail.plan,
        layers: [l1Layer, ...(detail.context.layers ?? [])],
        memoryHits: [],
        experts,
        expertOrder: order,
        synthesis: detail.synthesis,
        operations: mergedOperations,
        memories: detail.memories ?? [],
        badcase: detail.badcase ?? null,
        latencyMs: detail.latencyMs,
        notices: [],
      });
      setGoal(detail.goal);
      runIdRef.current = detail.id;
      await refreshDecisions(detail.id);
      await refreshPendingAll();
      setTraceOpen(false);
      setActiveModule("team");
    } catch (error) {
      toast(error instanceof Error ? error.message : "任务加载失败", "warn");
    }
  };

  const handleUndo = async (operation: AdOperation) => {
    try {
      const result = await undoOperation(operation.id);
      if (result.ok) {
        setRun((prev) =>
          prev
            ? {
                ...prev,
                operations: prev.operations.map((item) => (item.id === result.operation.id ? result.operation : item)),
              }
            : prev,
        );
        await refreshOperations();
        toast("已撤销，数据看板同步恢复", "success");
      } else {
        toast(result.error ?? "撤销失败", "warn");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "撤销失败", "warn");
    }
  };

  const handleApproveDecision = async (decision: AdDecision, comment: string) => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    try {
      const result = await approveDecision(decision.id, comment);
      if (!result.ok) {
        toast(result.error ?? "确认失败", "warn");
        return;
      }
      setDecisions((prev) => prev.map((item) => (item.id === result.decision.id ? result.decision : item)));
      setPendingAll((prev) => prev.filter((item) => item.id !== result.decision.id));
      if (result.operation) {
        addOperation(result.operation);
        setRun((prev) =>
          prev && !prev.operations.some((item) => item.id === result.operation?.id)
            ? { ...prev, operations: [...prev.operations, result.operation as AdOperation] }
            : prev,
        );
      }
      await refreshOperations();
      setReviewDecision(null);
      toast("已确认并执行，可在已执行操作中撤销", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "确认失败", "warn");
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleRejectDecision = async (decision: AdDecision, comment: string) => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    try {
      const result = await rejectDecision(decision.id, comment);
      if (!result.ok) {
        toast(result.error ?? "拒绝失败", "warn");
        return;
      }
      setDecisions((prev) => prev.map((item) => (item.id === result.decision.id ? result.decision : item)));
      setPendingAll((prev) => prev.filter((item) => item.id !== result.decision.id));
      setReviewDecision(null);
      toast("已拒绝该动作，不会执行", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "拒绝失败", "warn");
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleVerify = async (entry: MemoryEntry) => {
    try {
      const result = await verifyMemory(entry.id);
      if (result.ok) {
        setMemory((prev) => prev.map((item) => (item.id === result.entry.id ? result.entry : item)));
        setRun((prev) =>
          prev ? { ...prev, memories: prev.memories.map((item) => (item.id === result.entry.id ? result.entry : item)) } : prev,
        );
        await refreshMemory();
        toast("回看完成", "success");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "验证失败", "warn");
    }
  };

  const submitBadcase = async (id: string, category: string, note: string) => {
    try {
      const source = role === "pm" ? "pm" : "user";
      const result = await tagBadcase(id, category, note, source);
      await refreshRuns();
      setRun((prev) => (prev && prev.id === id ? { ...prev, badcase: result.badcase } : prev));
      setBadcaseId(null);
      toast(source === "pm" ? "已标记 Badcase，可在工作痕迹中筛选" : "已提交反馈，产品经理会在工作痕迹中复盘", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "提交失败", "warn");
    }
  };

  const removeBadcase = async (id: string) => {
    try {
      await clearBadcase(id);
      await refreshRuns();
      setRun((prev) => (prev && prev.id === id ? { ...prev, badcase: null } : prev));
      setBadcaseId(null);
      toast(role === "pm" ? "已清除 Badcase 标记" : "已撤回反馈", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "操作失败", "warn");
    }
  };

  const reset = () => {
    if (running) abortRef.current?.abort();
    setRun(null);
    setGoal("");
  };

  const expertList: UiExpert[] = useMemo(() => {
    if (!run) return [];
    const ids = run.expertOrder.length ? run.expertOrder : (run.plan?.experts ?? []).map((item) => item.id);
    return ids.map((id) => {
      const existing = run.experts[id];
      if (existing) return existing;
      const planItem = run.plan?.experts.find((item) => item.id === id);
      return {
        id,
        name: planItem?.name ?? id,
        role: planItem?.role ?? "",
        focus: planItem?.focus ?? "",
        status: "queued" as const,
        finding: "",
        tools: [],
        color: "",
        canWrite: id === "ads",
      };
    });
  }, [run]);

  const stageIndex = !run
    ? -1
    : run.status === "done"
      ? 4
      : run.synthesis
        ? 3
        : Object.values(run.experts).some((expert) => expert.status === "running")
          ? 2
          : run.plan
            ? 1
            : 0;

  const activeOperations = operations.filter((operation) => !operation.undone);
  const runOperations = run?.operations ?? [];
  const pendingDecisions = decisions.filter((decision) => decision.status === "pending");
  const isPm = role === "pm";
  const badcaseCount = runs.filter((item) => item.badcase && item.badcase.source !== "user").length;
  const feedbackCount = runs.filter((item) => item.badcase?.source === "user").length;
  const badcaseRun = badcaseId ? runs.find((item) => item.id === badcaseId) ?? null : null;
  const toolCount = Math.max(
    16,
    catalog.length
      ? new Set(catalog.flatMap((expert) => expert.tools.map((tool) => tool.name))).size
      : 0,
  );
  const skillCount = Math.max(
    6,
    catalog.length
      ? new Set(catalog.flatMap((expert) => expert.skills.map((skill) => skill.id))).size
      : 0,
  );
  const expertCount = catalog.length || 3;
  const activeExpert = catalog.find((expert) => expert.id === activeExpertId) ?? catalog[0] ?? null;
  const ActiveExpertIcon = activeExpert ? (EXPERT_ICONS[activeExpert.id] ?? Sparkles) : Sparkles;

  const openSkillDetail = async (id: string) => {
    try {
      setToolDetail(null);
      const data = await getCapabilitySkills();
      const found = data.skills.find((skill) => skill.id === id);
      if (found) setSkillDetail(found);
      else toast("没有找到这个技能", "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : "加载技能失败", "warn");
    }
  };

  const openToolDetail = async (name: string) => {
    try {
      setSkillDetail(null);
      const data = await getCapabilityTools();
      const found = data.tools.find((tool) => tool.id === name || tool.name === name);
      if (found) setToolDetail(found);
      else toast("没有找到这个工具", "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : "加载工具失败", "warn");
    }
  };

  const home = (
    <div className="pt-home">
      <header className="pt-home-head">
        <div className="pt-home-head-left">
          <button type="button" className="pt-back" onClick={() => setActiveTab("workspace")}>
            <ArrowLeft size={13} /> 返回
          </button>
          <div className="pt-side-brand">
            <span className="pt-logo"><Sparkles size={17} /></span>
            <div>
              <div className="pt-side-title">GetMore</div>
              <div className="pt-side-sub">智能经营工作台</div>
            </div>
          </div>
        </div>
        <span className="pt-home-status">
          <span className={`status-dot ${health?.provider_ready ? "online" : "offline"}`} />
          {health ? `${health.model} · 已授权` : healthError ? "服务未连接" : "连接中…"}
        </span>
      </header>

      <div className="pt-home-grid">
        <button type="button" className="pt-home-card" onClick={() => setActiveModule("experts")}>
          <span className="pt-home-icon tone-violet"><Sparkles size={19} /></span>
          <span className="pt-home-card-title">专家团队</span>
          <span className="pt-home-card-desc">{expertCount} 个专家 · {toolCount} 个工具 · {skillCount} 个技能</span>
          <span className="pt-home-card-foot">查看专家与工具 <ArrowUpRight size={12} /></span>
        </button>
        <button type="button" className="pt-home-card" onClick={() => setTraceOpen(true)}>
          <span className="pt-home-icon tone-blue"><History size={19} /></span>
          <span className="pt-home-card-title">工作痕迹</span>
          <span className="pt-home-card-desc">{runs.length} 次运行 · {badcaseCount} 个 Badcase</span>
          <span className="pt-home-card-foot">查看记录 <ArrowUpRight size={12} /></span>
        </button>
        <button type="button" className="pt-home-card" onClick={() => setCapabilityOpen(true)}>
          <span className="pt-home-icon tone-orange"><Boxes size={19} /></span>
          <span className="pt-home-card-title">能力</span>
          <span className="pt-home-card-desc">{skillCount} 个技能 · {toolCount} 个工具</span>
          <span className="pt-home-card-foot">管理能力 <ArrowUpRight size={12} /></span>
        </button>
      </div>

      {pendingAll.length > 0 && (
        <button type="button" className="pt-home-pending" onClick={() => setPendingOpen(true)}>
          <span className="pt-home-pending-icon"><ShieldCheck size={15} /></span>
          <span>
            <b>{pendingAll.length} 个待确认动作</b>
            <small>写动作不会自动执行，确认后才生效</small>
          </span>
          <ArrowUpRight size={13} />
        </button>
      )}

    </div>
  );

  const expertsPage = (
    <div className="pt-module-page">
      <header className="pt-top">
        <div className="pt-title-wrap">
          <button type="button" className="pt-back" onClick={() => setActiveModule("home")}>
            <ArrowLeft size={13} /> 返回
          </button>
          <div>
            <h2>专家团队</h2>
            <p>{expertCount} 个专家 · {skillCount} 个技能 · {toolCount} 个工具</p>
          </div>
        </div>
      </header>

      <div className="pt-expert-dir">
        <aside className="pt-expert-dir-list">
          {catalog.map((expert) => {
            const Icon = EXPERT_ICONS[expert.id] ?? Sparkles;
            return (
              <button
                key={expert.id}
                type="button"
                className={`pt-expert-dir-item ${activeExpert?.id === expert.id ? "is-active" : ""}`}
                onClick={() => setActiveExpertId(expert.id)}
              >
                <span className={`pt-expert-dir-icon tone-${EXPERT_TONES[expert.id] ?? "violet"}`}>
                  <Icon size={15} />
                </span>
                <span className="pt-expert-dir-item-main">
                  <b>{expert.name}</b>
                  <small>{expert.role}</small>
                </span>
                <span className="pt-expert-dir-count">{expert.tools.length}</span>
              </button>
            );
          })}
          {!catalog.length && <div className="pt-empty-small">正在加载专家…</div>}
        </aside>

        {activeExpert ? (
          <section className="pt-expert-dir-detail">
            <div className="pt-expert-dir-head">
              <span className={`pt-expert-dir-icon is-large tone-${EXPERT_TONES[activeExpert.id] ?? "violet"}`}>
                <ActiveExpertIcon size={20} />
              </span>
              <div>
                <h3>{activeExpert.name}</h3>
                <p>{activeExpert.role}</p>
              </div>
              <span className={`tag ${activeExpert.canWrite ? "tag-orange" : "tag-gray"}`}>
                {activeExpert.canWrite ? "可提交动作" : "只读"}
              </span>
            </div>

            <p className="pt-expert-dir-success">{activeExpert.success}</p>

            <div className="pt-expert-dir-section">
              <div className="pt-expert-dir-title">
                技能 <span>{activeExpert.skills.length}</span>
              </div>
              <div className="pt-expert-dir-skills">
                {activeExpert.skills.length ? (
                  activeExpert.skills.map((skill) => (
                    <button
                      type="button"
                      className="pt-expert-dir-skill"
                      key={skill.id}
                      title="查看技能详情"
                      onClick={() => void openSkillDetail(skill.id)}
                    >
                      {skill.name}
                      <small>v{skill.version}</small>
                    </button>
                  ))
                ) : (
                  <span className="pt-expert-dir-empty">这个专家不绑定技能</span>
                )}
              </div>
            </div>

            <div className="pt-expert-dir-section">
              <div className="pt-expert-dir-title">
                工具 <span>{activeExpert.tools.length}</span>
              </div>
              <div className="pt-expert-dir-tools">
                {activeExpert.tools.map((tool) => (
                  <button
                    type="button"
                    className="pt-expert-dir-tool"
                    key={tool.name}
                    title="查看工具详情"
                    onClick={() => void openToolDetail(tool.name)}
                  >
                    <span className="pt-expert-dir-tool-head">
                      <b>{tool.name}</b>
                      <ArrowUpRight size={10} />
                    </span>
                    <span>{tool.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <p className="pt-expert-dir-note">
              工具按专家绑定；写动作只提交待确认 Decision，人工确认后才执行。
            </p>
          </section>
        ) : (
          <div className="pt-expert-dir-empty">暂无专家</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="partner-view is-home-shell">
      {activeModule === "home" && home}
      {activeModule === "experts" && expertsPage}
      <aside className="pt-side">
        <div className="pt-side-brand">
          <span className="pt-logo"><Sparkles size={17} /></span>
          <div>
            <div className="pt-side-title">GetMore</div>
            <div className="pt-side-sub">大模型规划 · 提案确认</div>
          </div>
        </div>
        <button type="button" className="pt-new-btn" onClick={reset}>
          <Plus size={15} /> 新建任务
        </button>
        <button type="button" className="pt-trace-entry" onClick={() => setTraceOpen(true)}>
          <span className="pt-trace-entry-icon"><History size={14} /></span>
          <span className="pt-trace-entry-text">
            <b>查看工作痕迹</b>
            <small>
              {runs.length} 次运行
              {isPm && badcaseCount > 0 ? ` · ${badcaseCount} 个 Badcase` : ""}
              {!isPm && feedbackCount > 0 ? ` · ${feedbackCount} 条反馈` : ""}
            </small>
          </span>
          <ArrowUpRight size={11} />
        </button>
        <button type="button" className="pt-trace-entry pt-getmore-entry" onClick={reset}>
          <span className="pt-trace-entry-icon"><Sparkles size={14} /></span>
          <span className="pt-trace-entry-text">
            <b>GetMore</b>
            <small>大模型规划 · 工具与技能</small>
          </span>
          <ArrowUpRight size={11} />
        </button>
        {pendingAll.length > 0 && (
          <button type="button" className="pt-pending-entry" onClick={() => setPendingOpen(true)}>
            <span className="pt-pending-entry-icon"><ShieldCheck size={14} /></span>
            <span className="pt-pending-entry-text">
              <b>待确认动作</b>
              <small>{pendingAll.length} 个提案等待你处理</small>
            </span>
            <span className="pt-pending-count">{pendingAll.length}</span>
          </button>
        )}
        <div className="pt-side-caption">专家团队</div>
        <div className="pt-expert-mini">
          {catalog.map((expert) => {
            const Icon = EXPERT_ICONS[expert.id] ?? Sparkles;
            return (
              <button key={expert.id} type="button" onClick={() => setToolsOpen(true)}>
                <span className={`pt-mini-icon tone-${EXPERT_TONES[expert.id]}`}><Icon size={13} /></span>
                <span className="pt-mini-main">
                  <span>{expert.name}</span>
                  <span>
                    {expert.tools.length} 工具
                    {expert.skills.length > 0 ? ` · ${expert.skills.length} 技能` : ""}
                    {" · "}
                    {expert.canWrite ? "提交审批" : "只读"}
                  </span>
                </span>
                <ArrowUpRight size={11} />
              </button>
            );
          })}
        </div>
        <div className="pt-side-foot">
          <span className={`status-dot ${health?.provider_ready ? "online" : "offline"}`} />
          <span className="pt-side-foot-text">
            {health ? `${health.model} · 已授权` : healthError ? "服务未连接" : "连接中…"}
          </span>
        </div>
      </aside>

      <main className="pt-main">
        <header className="pt-top">
          <div className="pt-title-wrap">
            <button type="button" className="pt-back" onClick={() => setActiveModule("home")}>
              <ArrowLeft size={13} /> 返回
            </button>
            <div>
              <h2>
                GetMore团队
                <span className="pt-permission"><ShieldCheck size={11} /> 写动作需确认</span>
              </h2>
              <p>大模型规划 · 工具与技能 · 提案需确认</p>
            </div>
          </div>
          <div className="pt-top-actions">
            <button type="button" className="btn btn-default btn-sm" onClick={reset}>
              <Plus size={13} /> 新建任务
            </button>
            {pendingAll.length > 0 && (
              <button type="button" className="btn btn-default btn-sm" onClick={() => setPendingOpen(true)}>
                <ShieldCheck size={13} /> 待确认 {pendingAll.length}
              </button>
            )}
            <div className="pt-range-wrap">
              <button
                type="button"
                className={`btn btn-default btn-sm ${rangeOpen ? "is-active" : ""}`}
                onClick={() => setRangeOpen((value) => !value)}
                disabled={!snapshot}
                title={snapshot ? "选择本次任务的数据范围" : "先打开数据看板同步范围"}
              >
                <CalendarDays size={13} />
                {snapshot ? `${snapshot.range.start} ~ ${snapshot.range.end}` : "近 7 天"}
              </button>
              {rangeOpen && snapshot && (
                <DateRangePopover
                  range={snapshot.range}
                  onClose={() => setRangeOpen(false)}
                  onApply={(next) => {
                    setSnapshot({ ...snapshot, range: next });
                    setRangeOpen(false);
                    toast("任务数据范围已更新", "success");
                  }}
                />
              )}
            </div>
          </div>
        </header>

        <div className="pt-stages">
          {STAGES.map((stage, index) => (
            <div key={stage} className={`pt-stage ${index <= stageIndex ? "is-done" : ""} ${index === stageIndex ? "is-active" : ""}`}>
              <span className="pt-stage-dot">{index < stageIndex ? <Check size={9} /> : index + 1}</span>
              {stage}
              {index < STAGES.length - 1 && <i />}
            </div>
          ))}
        </div>

        {healthError && (
          <div className="pt-banner">
            <AlertTriangle size={14} />
            <span>编排服务未连接：{healthError}</span>
            <code>npm run partner</code>
            <span className="spacer" />
            <button type="button" className="btn btn-default btn-sm" onClick={() => window.location.reload()}>
              <RefreshCw size={12} /> 重试
            </button>
          </div>
        )}

        <div
          className="pt-scroll"
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
          }}
        >
          {!run ? (
            <div className="pt-empty">
              <span className="pt-hero-badge"><Sparkles size={11} /> Agent 提案 · 优化师确认</span>
              <h1>
                交代目标，<em>它先提案，由你确认。</em>
              </h1>
              <p className="pt-hero-sub">
                巨量伙伴会查数、分工、提交预算 / 停计划 / 调出价提案。优化师确认后才执行，所有动作都有护栏、审计，可一键撤销。
              </p>
              <div className="pt-capabilities">
                {["查数定位", "预算调整", "计划启停", "出价优化", "复盘验证"].map((item) => (
                  <span key={item} className="pt-capability"><Check size={10} /> {item}</span>
                ))}
              </div>
              <div className="pt-example-grid">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.title}
                    type="button"
                    className="pt-example"
                    onClick={() => {
                      setGoal(example.goal);
                      void startRun(example.goal);
                    }}
                  >
                    <span className="pt-example-icon"><example.icon size={14} /></span>
                    <span>
                      <strong>{example.title}</strong>
                      <span>{example.goal}</span>
                    </span>
                    <ArrowUpRight size={13} className="pt-example-arrow" />
                  </button>
                ))}
              </div>
              <div className="pt-hero-foot">
                <ShieldCheck size={12} /> 模拟账户 · 提案经你确认后才生效 · 预算 ±20% / 出价 ±15% / 单次最多 3 个动作
              </div>
            </div>
          ) : (
            <div className="pt-run">
              <div className="pt-goal">
                <div className="pt-goal-head">
                  <span className="pt-goal-label">目标</span>
                  <span className="pt-meta">
                    {run.range ? `${run.range.start} ~ ${run.range.end}` : "近 7 天"} · {view.channel === "brand" ? "品牌" : "竞价"} ·{" "}
                    {view.dimensionLabel}
                  </span>
                </div>
                <p>{run.goal}</p>
                {run.badcase && (isPm || run.badcase.source === "user") && (
                  <div className="pt-goal-badcase">
                    <Flag size={11} />{" "}
                    {isPm
                      ? run.badcase.source === "user"
                        ? `用户反馈 · ${run.badcase.category}`
                        : `Badcase · ${run.badcase.category}`
                      : "已反馈"}
                    {isPm && run.badcase.note ? <span>{run.badcase.note}</span> : null}
                  </div>
                )}
              </div>

              {pendingDecisions.length > 0 && (
                <div className="pt-pending-banner">
                  <ShieldCheck size={13} />
                  有 <b>{pendingDecisions.length}</b> 个动作等待你确认，确认后才会执行
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => document.querySelector(".pt-decisions")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    去确认
                  </button>
                </div>
              )}

              {runOperations.length > 0 && (
                <div className="pt-executed-banner">
                  <Zap size={13} />
                  Agent 已确认执行 <b>{runOperations.length}</b> 项操作，看板已同步
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => operationsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    查看操作
                  </button>
                  <button type="button" className="btn-link" onClick={() => setActiveTab("data")}>
                    查看数据 <ArrowUpRight size={12} />
                  </button>
                </div>
              )}

              {run.plan && (
                <section className="pt-card pt-plan">
                  <header className="pt-card-head">
                    <span className="pt-card-icon tone-violet"><Compass size={14} /></span>
                    <div>
                      <div className="pt-card-title">执行计划</div>
                      <div className="pt-card-sub">{run.plan.intent}</div>
                    </div>
                    <span className="pt-plan-count">{run.plan.experts.length} 位专家</span>
                  </header>
                  <div className="pt-plan-grid is-simple">
                    <div>
                      {run.plan.experts.map((expert) => (
                        <div key={expert.id} className="pt-plan-expert">
                          <span className={`pt-plan-dot tone-${EXPERT_TONES[expert.id]}`} />
                          <b>{expert.name}</b>
                          <span>{expert.focus}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-plan-criteria">
                      <span className="pt-plan-label">成功标准</span>
                      <div>{run.plan.successCriteria.slice(0, 2).join("；")}</div>
                    </div>
                  </div>
                  <div className="pt-plan-skill">
                    <span className="pt-plan-label">技能路由</span>
                    <div>
                      {run.plan.skills?.length
                        ? run.plan.skills.map((skill) => `${skill.name} v${skill.version}`).join(" / ")
                        : "未命中技能，使用基础 prompt"}
                    </div>
                  </div>
                </section>
              )}

              {expertList.length > 0 && (
                <div className={`pt-expert-grid cols-${Math.min(3, expertList.length)}`}>
                  {expertList.map((expert) => (
                    <ExpertCard key={expert.id} expert={expert} />
                  ))}
                </div>
              )}

              {run.layers.length > 0 && (
                <section className="pt-card pt-context-card">
                  <header className="pt-card-head">
                    <span className="pt-card-icon tone-blue"><Database size={14} /></span>
                    <div>
                      <div className="pt-card-title">上下文</div>
                      <div className="pt-card-sub">L1 共享 · L2/L3 按专家切片 · {run.layers.reduce((sum, layer) => sum + layer.tokens, 0)} tokens</div>
                    </div>
                  </header>
                  <div className="pt-layers">
                    {run.layers.map((layer) => {
                      const key = `${layer.key}-${layer.expertId ?? "shared"}`;
                      return (
                        <LayerRow
                          key={key}
                          layer={layer}
                          open={openLayer === key}
                          onToggle={() => setOpenLayer((prev) => (prev === key ? null : key))}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              {(run.synthesis || (run.status === "running" && stageIndex >= 2)) && (
                <section className="pt-card pt-synthesis">
                  <header className="pt-card-head">
                    <span className="pt-card-icon tone-violet"><Sparkles size={14} /></span>
                    <div>
                      <div className="pt-card-title">决策</div>
                      <div className="pt-card-sub">对齐 ROI / 风险标准</div>
                    </div>
                    {run.status === "running" && !run.synthesis && (
                      <span className="pt-streaming"><Loader2 size={11} className="spin" /> 生成中</span>
                    )}
                    {run.status === "done" && run.latencyMs && (
                      <span className="pt-meta"><Clock size={10} /> {(run.latencyMs / 1000).toFixed(1)}s</span>
                    )}
                  </header>
                  {run.synthesis ? (
                    <MarkdownView text={run.synthesis} />
                  ) : (
                    <div className="pt-thinking"><Loader2 size={13} className="spin" /> 汇总专家判断</div>
                  )}
                </section>
              )}

              {decisions.length > 0 && (
                <section className="pt-card pt-decisions">
                  <header className="pt-card-head">
                    <span className="pt-card-icon tone-amber"><ShieldCheck size={14} /></span>
                    <div>
                      <div className="pt-card-title">{pendingDecisions.length > 0 ? "待优化师确认" : "动作确认记录"}</div>
                      <div className="pt-card-sub">Agent 提议 · 确认后才执行 · 30 分钟有效</div>
                    </div>
                    <span className="pt-plan-count">{pendingDecisions.length} 待确认 / {decisions.length} 总计</span>
                  </header>
                  <div className="pt-decision-list">
                    {decisions.map((decision) => (
                      <DecisionRow key={decision.id} decision={decision} onReview={setReviewDecision} />
                    ))}
                  </div>
                </section>
              )}

              {runOperations.length > 0 && (
                <section className="pt-card pt-operations" ref={operationsRef}>
                  <header className="pt-card-head">
                    <span className="pt-card-icon tone-orange"><Zap size={14} /></span>
                    <div>
                      <div className="pt-card-title">已执行操作</div>
                      <div className="pt-card-sub">优化师确认后生效 · 可撤销 · 已写入审计</div>
                    </div>
                    <span className="pt-plan-count">{runOperations.filter((operation) => !operation.undone).length} 生效</span>
                  </header>
                  <div className="pt-operation-list">
                    {runOperations.map((operation) => (
                      <OperationRow key={operation.id} operation={operation} onUndo={handleUndo} />
                    ))}
                  </div>
                </section>
              )}

              {run.error && (
                <div className="pt-banner is-error"><AlertTriangle size={14} /> {run.error}</div>
              )}

              {run.status === "done" && (
                <div className="pt-done">
                  <span><Check size={12} /> 完成</span>
                  <span>{run.operations.length} 个操作</span>
                  <span className="spacer" />
                  {isPm && (
                    <button type="button" className="btn-link" onClick={() => setBadcaseId(run.id)}>
                      <Flag size={12} /> {run.badcase ? "更新 Badcase" : "标记 Badcase"}
                    </button>
                  )}
                  {!isPm && (!run.badcase || run.badcase.source === "user") && (
                    <button type="button" className="btn-link" onClick={() => setBadcaseId(run.id)}>
                      <Flag size={12} /> {run.badcase?.source === "user" ? "更新反馈" : "反馈问题"}
                    </button>
                  )}
                  {!isPm && run.badcase && run.badcase.source !== "user" && (
                    <span className="pt-meta">已由产品经理处理</span>
                  )}
                  <button type="button" className="btn-link" onClick={() => setTraceOpen(true)}>
                    工作痕迹
                  </button>
                  <button type="button" className="btn-link" onClick={() => setActiveTab("data")}>
                    打开数据看板 <ArrowUpRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pt-composer-wrap">
          <div className={`pt-composer ${running ? "is-running" : ""}`}>
            <textarea
              value={goal}
              rows={1}
              placeholder="告诉 Agent 要达成什么，例如：停掉 ROI 低于 3 的计划，把预算加到头部账户"
              onChange={(event) => {
                setGoal(event.target.value);
                const element = event.currentTarget;
                element.style.height = "auto";
                element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void startRun();
                }
              }}
              disabled={running}
            />
            <div className="pt-composer-tools">
              <span className="pt-scope">
                <Sparkles size={11} /> {view.channel === "brand" ? "品牌" : "竞价"} · {view.dimensionLabel} ·{" "}
                {snapshot?.range ? `${snapshot.range.start} ~ ${snapshot.range.end}` : "近 7 天"}
              </span>
              <span className="spacer" />
              <span className="pt-composer-hint"><kbd>Enter</kbd> 执行</span>
              {running ? (
                <button type="button" className="pt-run-btn is-stop" onClick={() => abortRef.current?.abort()}>
                  <Square size={12} /> 停止
                </button>
              ) : (
                <button type="button" className="pt-run-btn" disabled={!goal.trim()} onClick={() => void startRun()}>
                  <Play size={13} /> 执行
                </button>
              )}
            </div>
          </div>
          <div className="pt-composer-foot">动作先提交，优化师确认后生效；可在「已执行操作」中撤销</div>
        </div>
      </main>

      <aside className="pt-rail">
        <div className="pt-rail-section">
          <div className="pt-rail-title"><span className="live-dot" /> 共享上下文 L1</div>
          <div className="pt-rail-card">
            {run?.layers.find((layer) => layer.key === "L1") ? (
              <>
                <pre className={`pt-rail-content ${railExpanded ? "is-expanded" : ""}`}>
                  {run.layers.find((layer) => layer.key === "L1")?.content}
                </pre>
                <button type="button" className="pt-rail-more" onClick={() => setRailExpanded((prev) => !prev)}>
                  {railExpanded ? "收起" : "展开"}
                </button>
              </>
            ) : (
              <p className="pt-rail-placeholder">任务开始后展示所有专家共享的目标、大盘与记忆。</p>
            )}
          </div>
        </div>

        <div className="pt-rail-section">
          <div className="pt-rail-title"><ShieldCheck size={12} /> 执行护栏</div>
          <div className="pt-rail-card pt-guardrails">
            <div className="pt-guardrail"><b>预算</b><span>单次 ≤ ±20%</span></div>
            <div className="pt-guardrail"><b>出价</b><span>单次 ≤ ±15%</span></div>
            <div className="pt-guardrail"><b>ROI</b><span>预测不低于 2.5</span></div>
            <div className="pt-guardrail"><b>余额</b><span>低于 1000 元不执行</span></div>
            <div className="pt-guardrail"><b>次数</b><span>单次任务最多 3 个动作</span></div>
          </div>
        </div>

        <div className="pt-rail-section">
          <div className="pt-rail-title"><Zap size={12} /> 最近操作</div>
          <div className="pt-rail-card pt-op-mini">
            {activeOperations.slice(0, 3).map((operation) => (
              <div key={operation.id} className="pt-op-mini-row">
                <span className={`pt-op-mini-dot ${operation.field}`} />
                <span>{operation.target_name}</span>
                <b>
                  {operation.field === "status"
                    ? formatOperationValue(operation, operation.after)
                    : formatOperationValue(operation, operation.after)}
                </b>
              </div>
            ))}
            {activeOperations.length === 0 && <p className="pt-rail-placeholder">Agent 执行的动作会出现在这里。</p>}
            {activeOperations.length > 0 && (
              <button type="button" className="pt-rail-more" onClick={() => setActiveTab("data")}>
                在数据看板查看
              </button>
            )}
          </div>
        </div>

        <div className="pt-rail-section">
          <div className="pt-rail-title"><Database size={12} /> 最近记忆</div>
          <div className="pt-rail-card pt-memory-mini">
            {memory.slice(0, 3).map((entry) => (
              <div key={entry.id} className="pt-memory-mini-row">
                <span className={`pt-memory-kind is-${entry.kind}`}>
                  {entry.kind === "decision" ? "决策" : entry.kind === "preference" ? "偏好" : "结果"}
                </span>
                <span>{entry.text.slice(0, 44)}…</span>
              </div>
            ))}
            {memory.length === 0 && <p className="pt-rail-placeholder">任务结束后自动写回。</p>}
            <button type="button" className="pt-rail-more" onClick={() => setMemoryOpen(true)}>查看记忆</button>
          </div>
        </div>

        {run?.status === "done" && (
          <div className="pt-rail-section">
            <div className="pt-rail-title"><Clock size={12} /> 本次运行</div>
            <div className="pt-rail-card pt-stats">
              <div><span>耗时</span><b>{run.latencyMs ? `${(run.latencyMs / 1000).toFixed(1)}s` : "--"}</b></div>
              <div><span>专家</span><b>{run.expertOrder.length}</b></div>
              <div><span>工具</span><b>{Object.values(run.experts).reduce((sum, expert) => sum + expert.tools.length, 0)}</b></div>
              <div><span>操作</span><b>{run.operations.length}</b></div>
            </div>
          </div>
        )}
      </aside>

      <Modal
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        title="待确认动作"
        desc="所有 Agent 提案都需要优化师确认；30 分钟内有效。"
        className="pt-pending-modal"
        footer={<button type="button" className="btn btn-default" onClick={() => setPendingOpen(false)}>关闭</button>}
      >
        {pendingAll.length === 0 ? (
          <div className="pt-session-empty">没有待确认动作</div>
        ) : (
          <div className="pt-decision-list">
            {pendingAll.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                onReview={(item) => {
                  setPendingOpen(false);
                  setReviewDecision(item);
                }}
              />
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(skillDetail)}
        onClose={() => setSkillDetail(null)}
        title={skillDetail ? `${skillDetail.name} v${skillDetail.version}` : "技能"}
        desc={skillDetail ? `${skillDetail.id} · 绑定 ${skillDetail.expertIds.join(" / ")}` : ""}
        width={760}
        className="pt-detail-modal"
      >
        {skillDetail && (
          <div className="pt-detail">
            <p className="pt-detail-lead">{skillDetail.description}</p>
            {skillDetail.businessProblem && (
              <section>
                <h4>业务问题</h4>
                <p>{skillDetail.businessProblem}</p>
              </section>
            )}
            {skillDetail.designRationale && (
              <section>
                <h4>设计思路</h4>
                <p>{skillDetail.designRationale}</p>
              </section>
            )}
            <section>
              <h4>触发条件</h4>
              <div className="pt-detail-chips">
                {skillDetail.trigger.length ? (
                  skillDetail.trigger.map((item) => <span key={item}>{item}</span>)
                ) : (
                  <em>未填写</em>
                )}
              </div>
            </section>
            <section>
              <h4>步骤</h4>
              {skillDetail.steps.length ? (
                <ol className="pt-detail-steps">
                  {skillDetail.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              ) : (
                <p>未填写</p>
              )}
            </section>
            <section>
              <h4>输出</h4>
              <pre className="pt-detail-json">{JSON.stringify(skillDetail.output ?? {}, null, 2)}</pre>
            </section>
            <section>
              <h4>失败处理</h4>
              <p>{skillDetail.failure || "未填写"}</p>
            </section>
            <section>
              <h4>Instructions</h4>
              <pre className="pt-detail-json">{skillDetail.instructions || "未填写"}</pre>
            </section>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(toolDetail)}
        onClose={() => setToolDetail(null)}
        title={toolDetail?.name ?? "工具"}
        desc={toolDetail ? `${toolDetail.id} · ${toolDetail.source === "code" ? "代码工具" : "导入定义"}` : ""}
        width={680}
        className="pt-detail-modal"
      >
        {toolDetail && (
          <div className="pt-detail">
            <div className="pt-detail-meta">
              <span className={`tag ${toolDetail.risk === "read" ? "tag-gray" : toolDetail.risk === "destructive" ? "tag-red" : "tag-orange"}`}>
                {toolDetail.risk === "read" ? "只读" : toolDetail.risk === "destructive" ? "高风险" : "可写"}
              </span>
              <span>{toolDetail.expertNames.join(" / ") || "未绑定专家"}</span>
              <span>{toolDetail.executable ? "已注册执行" : "仅定义，不可执行"}</span>
            </div>
            <p className="pt-detail-lead">{toolDetail.description}</p>
            <section>
              <h4>参数</h4>
              <pre className="pt-detail-json">{JSON.stringify(toolDetail.parameters ?? {}, null, 2)}</pre>
            </section>
          </div>
        )}
      </Modal>

      <DecisionReviewModal
        decision={reviewDecision}
        busy={decisionBusy}
        onClose={() => setReviewDecision(null)}
        onApprove={(decision, comment) => void handleApproveDecision(decision, comment)}
        onReject={(decision, comment) => void handleRejectDecision(decision, comment)}
      />

      <CapabilityCenterModal
        open={capabilityOpen}
        onClose={() => setCapabilityOpen(false)}
        onBack={() => setCapabilityOpen(false)}
      />
      <ExperimentDrawer
        open={experimentOpen}
        onClose={() => setExperimentOpen(false)}
        onOpenPending={(decisionId) => {
          setExperimentOpen(false);
          void refreshPendingAll().then((list) => {
            const target = decisionId ? list.find((item) => item.id === decisionId) : null;
            if (target) {
              setPendingOpen(false);
              setReviewDecision(target);
            } else {
              setPendingOpen(true);
            }
          });
        }}
        onOpenQuality={() => {
          setExperimentOpen(false);
          setQualityOpen(true);
        }}
      />
      <HypothesisModal open={qualityOpen} onClose={() => setQualityOpen(false)} />
      <TraceDrawer
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        onBack={() => {
          setTraceOpen(false);
        }}
        runs={runs}
        catalog={catalog}
        isPm={isPm}
        onOpen={(id) => {
          setTraceOpen(false);
          setActiveModule("team");
          void openRun(id);
        }}
        onTag={(id) => {
          setTraceOpen(false);
          setActiveModule("team");
          setBadcaseId(id);
        }}
      />
      <BadcaseModal
        open={Boolean(badcaseId)}
        run={badcaseRun}
        mode={isPm ? "pm" : "user"}
        onClose={() => setBadcaseId(null)}
        onSubmit={(id, category, note) => void submitBadcase(id, category, note)}
        onClear={(id) => void removeBadcase(id)}
      />
    </div>
  );
}

