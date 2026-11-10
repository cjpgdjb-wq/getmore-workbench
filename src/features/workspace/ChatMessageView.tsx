import { useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Database,
  Loader2,
  RefreshCw,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { fmtClock } from "../../lib/format";
import { describeAction } from "../../lib/agentAction";
import type { AgentAction } from "../../state/workbench";
import type { ChatMessage, ToolStep } from "./useAgentChat";

const TOOL_LABELS: Record<string, string> = {
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  list_dir: "浏览目录",
  glob: "查找文件",
  grep: "搜索内容",
  exec: "执行命令",
  shell: "执行命令",
  web_search: "联网搜索",
  web_fetch: "抓取网页",
  browser: "浏览器操作",
  image_generate: "生成图片",
  cron: "定时任务",
  message: "发送消息",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  return (
    <div className="code-block">
      <button
        type="button"
        className="code-copy"
        onClick={() => {
          const text = preRef.current?.textContent ?? "";
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

function StepCard({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const icon =
    step.status === "running" ? (
      <Loader2 size={13} className="spin" />
    ) : step.status === "error" ? (
      <AlertTriangle size={13} />
    ) : (
      <Check size={13} />
    );

  return (
    <div className={`step-card ${step.status}`}>
      <button type="button" className="step-head" onClick={() => setOpen((prev) => !prev)}>
        <span className="step-icon">
          <Wrench size={13} />
        </span>
        <span className="step-name">{toolLabel(step.name)}</span>
        <span className="step-hint">{step.hint}</span>
        <span className={`step-status ${step.status}`}>
          {icon}
          {step.status === "running" ? "执行中" : step.status === "error" ? "失败" : "完成"}
        </span>
        <ChevronDown size={12} className={`step-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <div className="step-body">
          {step.args && (
            <>
              <div className="step-body-label">参数</div>
              {step.args}
            </>
          )}
          {step.result && (
            <>
              <div className="step-body-label">结果</div>
              {step.result}
            </>
          )}
          {step.error && (
            <>
              <div className="step-body-label">错误</div>
              <span className="step-error">{step.error}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({ reasoning, streaming }: { reasoning?: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) return null;
  return (
    <div className={`reasoning-block ${open ? "is-open" : ""}`}>
      <button type="button" className="reasoning-head" onClick={() => setOpen((prev) => !prev)}>
        <Sparkles size={13} />
        <span>思考过程</span>
        {streaming && <span className="dots"><span /><span /><span /></span>}
        <ChevronDown size={12} className={`step-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && <div className="reasoning-body">{reasoning}</div>}
    </div>
  );
}

function ActionCard({
  action,
  applied,
  onApply,
}: {
  action: AgentAction;
  applied: boolean;
  onApply: () => void;
}) {
  const info = describeAction(action);
  return (
    <div className="action-card">
      <div className="action-card-head">
        <Zap size={13} className="spark" />
        Copilot 建议的操作
        <span className="tag tag-blue" style={{ marginLeft: "auto" }}>
          {info.detail}
        </span>
      </div>
      <div className="action-card-body">
        <div className="action-title">{info.title}</div>
        <div className="action-hint">点击后将在「数据」看板中直接生效，无需手动切换。</div>
        <div className="action-row">
          <span className="action-preview">{action.type}</span>
          <button type="button" className="action-run" disabled={applied} onClick={onApply}>
            {applied ? <Check size={12} /> : <Zap size={12} />}
            {applied ? "已执行" : "在看板中执行"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MessageView({
  message,
  onRetry,
  onApplyAction,
}: {
  message: ChatMessage;
  onRetry: () => void;
  onApplyAction: (action: AgentAction) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-body">
          <div className="user-bubble">
            {message.text}
            {message.context && (
              <div className="context-tag">
                <Database size={10} /> 附带工作台上下文
              </div>
            )}
          </div>
          <span className="msg-time">{fmtClock(message.createdAt)}</span>
        </div>
      </div>
    );
  }

  const hasContent = Boolean(message.text.trim());
  const streaming = Boolean(message.streaming);
  const showThinking = streaming && !hasContent;

  return (
    <div className="msg msg-agent">
      <span className="agent-avatar" aria-hidden="true">
        <Sparkles size={14} />
      </span>
      <div className="msg-body">
        <div className="agent-head">
          <span className="agent-name">GETmore Copilot</span>
          <span className="agent-tag">Nanobot</span>
          <span className="agent-time">{fmtClock(message.createdAt)}</span>
        </div>

        {message.steps && message.steps.length > 0 && (
          <div className="agent-steps">
            {message.steps.map((step) => (
              <StepCard key={step.id} step={step} />
            ))}
          </div>
        )}

        <ReasoningBlock reasoning={message.reasoning} streaming={streaming} />

        {showThinking && (
          <div className="think-card">
            <span className="think-icon">
              <Sparkles size={13} />
            </span>
            <span>
              正在理解你的问题并调用工作台数据
              <span className="dots"><span /><span /><span /></span>
            </span>
          </div>
        )}

        {hasContent && (
          <div className="agent-content">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre({ children }) {
                  return <CodeBlock>{children}</CodeBlock>;
                },
                a({ href, children }) {
                  return (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {message.text}
            </Markdown>
            {streaming && <span className="streaming-cursor" />}
          </div>
        )}

        {message.error && (
          <div className="agent-error">
            <AlertTriangle size={14} />
            <span>{message.error}</span>
            <button type="button" className="retry" onClick={onRetry}>
              重试
            </button>
          </div>
        )}

        {message.action && (
          <ActionCard
            action={message.action}
            applied={applied}
            onApply={() => {
              onApplyAction(message.action as AgentAction);
              setApplied(true);
            }}
          />
        )}

        {!streaming && (hasContent || message.error) && (
          <div className="agent-actions">
            <button
              type="button"
              className="agent-action"
              onClick={() => {
                navigator.clipboard?.writeText(message.text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "已复制" : "复制"}
            </button>
            <button type="button" className="agent-action" onClick={onRetry}>
              <RefreshCw size={12} /> 重新生成
            </button>
            {(message.latencyMs || message.usage?.output) && (
              <span className="agent-metric">
                {message.latencyMs ? `${(message.latencyMs / 1000).toFixed(1)}s` : ""}
                {message.latencyMs && message.usage?.output ? " · " : ""}
                {message.usage?.output ? `${message.usage.output} tokens` : ""}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MiniDeleteIcon() {
  return <X size={12} />;
}
