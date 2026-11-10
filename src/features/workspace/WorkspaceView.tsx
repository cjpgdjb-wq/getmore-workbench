import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  MessageSquarePlus,
  Package,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { fmtMoney, fmtRoi, relativeTime } from "../../lib/format";
import { useWorkbench, describeRange } from "../../state/workbench";
import type { AgentAction } from "../../state/workbench";
import { Sparkline, Select, useToast } from "../../components/ui";
import { DateRangePopover } from "../data/DataModals";
import { cpaOf, cpmOf, ctrOf, dataHealthOf, PRODUCTS, roiOf, sumSeries } from "../../data/mock";
import {
  approveDecision,
  getDecisions,
  proposeWorkspaceActions,
  rejectDecision,
  type AdDecision,
} from "../../lib/partner";
import { useAgentChat, type ChatSession } from "./useAgentChat";
import MessageView from "./ChatMessageView";
import ProductTree from "./ProductTree";
import ProductThreadModal from "./ProductThreadModal";
import WorkspaceCapabilitiesModal from "./WorkspaceCapabilitiesModal";
import WorkspaceDecisionPanel from "./WorkspaceDecisionPanel";
import { buildProductContext, getProductScopeForThread } from "./productThreads";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const WORKSPACE_CONTEXT_BUDGET = 32_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.72);
}

function summarizeSession(session: ChatSession | null | undefined): string {
  if (!session) return "";
  const turns = session.messages.filter((message) => message.text.trim()).slice(-6);
  if (turns.length === 0) return "";
  return turns
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";
      const text = message.text.replace(/\s+/g, " ").trim();
      return `${role}：${text.length > 160 ? `${text.slice(0, 160)}…` : text}`;
    })
    .join("\n");
}

function hasExecutionIntent(text: string): boolean {
  const value = text.replace(/\s+/g, "");
  return (
    /按(你的|我的)?规划执行|按规划|落地执行|直接执行/.test(value) ||
    /(请|帮我|现在|已经|直接).{0,12}(执行|加预算|降预算|调预算|调出价|暂停|恢复)/.test(value) ||
    /(执行|落地).{0,12}(预算|出价|计划)/.test(value) ||
    /^(把|给).{0,20}(预算|出价).{0,12}(加|降|调|提高|降低)/.test(value) ||
    /^(加|降|调|提|提高|降低|增加|减少).{0,10}(预算|出价)/.test(value) ||
    /^(预算|出价).{0,8}(加|降|调|提高|降低|增加|减少)/.test(value) ||
    /(提高|增加|上调|降低|减少|下调|调整).{0,20}(日投放|投放|预算|出价|计划)/.test(value) ||
    /(提交|生成).{0,8}(提案|执行|动作)/.test(value) ||
    /按这个(来|执行|做)|就按这个|可以.*(执行|提交)/.test(value)
  );
}

function buildContextText(
  snapshot: ReturnType<typeof useWorkbench>["snapshot"],
  selectedHint?: string,
): string {
  if (!snapshot) {
    return "[GETmore 工作台上下文 | 本地模拟数据]\n当前还没有打开数据看板，用户可能希望先了解工作台能力。";
  }
  const lines: string[] = [
    "[GETmore 工作台上下文 | 本地模拟数据]",
    `渠道: ${snapshot.channel === "auction" ? "竞价投放" : "品牌投放"}`,
    `看板维度: ${snapshot.dimensionLabel}`,
    `统计周期: ${snapshot.range.start} ~ ${snapshot.range.end}`,
    snapshot.channel === "auction" ? `投放方式: ${snapshot.mode}` : `品牌范围: ${snapshot.mode}`,
    `推广目标: ${snapshot.target}`,
    `组织范围: ${snapshot.orgName ?? "全部组织"}`,
    snapshot.search ? `当前搜索: ${snapshot.search}` : "",
    `账户总数: ${snapshot.totalCount}`,
    snapshot.channel === "auction"
      ? "说明: 当前 KPI 已按「投放方式 + 推广目标」切片；计划日序列已对账到账户日序列，拆分合计与当前 KPI 一致。"
      : "说明: 当前 KPI 按品牌范围切片（整体不含搜索 / 搜索）；品牌广告只有曝光、点击、CPM、CTR 口径，不展示支付 ROI。",
  ];
  if (snapshot.kpi.length) {
    lines.push(
      `KPI（当前切片：${snapshot.channel === "auction" ? `${snapshot.mode} · ${snapshot.target}` : `${snapshot.mode} · 品牌计划`}）:`,
    );
    for (const item of snapshot.kpi) lines.push(`- ${item.label}: ${item.value}`);
  }
  lines.push(
    `数据状态: 最近同步 ${snapshot.dataHealth.lastSyncedAt}，最大延迟 ${snapshot.dataHealth.lagMinutes} 分钟，完整度 ${(
      snapshot.dataHealth.completeness * 100
    ).toFixed(0)}%，延迟账户 ${snapshot.dataHealth.staleAccounts} 个，部分授权 ${snapshot.dataHealth.partialAccounts} 个。`,
  );
  lines.push(
    `缺失字段: ${snapshot.dataHealth.missing.length ? snapshot.dataHealth.missing.join("、") : "无"}。缺失字段不能推断为 0，也不能用于下结论。`,
  );
  lines.push("净成交/退款拆分只汇总已授权「商品交易」的账户；未授权账户不进入该口径。");
  lines.push(
    "绝对盈亏: 不可判断。巨量千川不提供商品成本、毛利、物流、退货等经营数据；不要根据 ROI 直接给出“赚/亏”结论。只能分析投放效率、目标达成和相对变化。",
  );
  if (snapshot.breakdowns.modes.length) {
    lines.push("投放方式拆分（当前渠道/日期，计划汇总；用于对比，不受当前投放方式筛选影响）:");
    for (const item of snapshot.breakdowns.modes) {
      lines.push(
        `- ${item.label}: 消耗 ${item.cost.toFixed(2)} 元，支付 ${item.revenue.toFixed(2)} 元，订单 ${item.orders}，ROI ${
          item.roi === null ? "--" : item.roi.toFixed(2)
        }，订单成本 ${item.cpa === null ? "--" : item.cpa.toFixed(2)} 元${
          item.netRevenue === null
            ? "，净成交数据未同步"
            : `，净成交 ${item.netRevenue.toFixed(2)} 元，净成交ROI ${
                item.netRoi === null ? "--" : item.netRoi.toFixed(2)
              }，退款率 ${item.refundRate === null ? "--" : (item.refundRate * 100).toFixed(1) + "%"}`
        }，计划 ${item.plans} 个，账户 ${item.accounts} 个，消耗占比 ${(item.share * 100).toFixed(1)}%`,
      );
    }
  }
  if (snapshot.breakdowns.targets.length) {
    lines.push("推广目标拆分（当前渠道/日期，计划汇总；用于对比，不受当前推广目标筛选影响）:");
    for (const item of snapshot.breakdowns.targets) {
      lines.push(
        `- ${item.label}: 消耗 ${item.cost.toFixed(2)} 元，支付 ${item.revenue.toFixed(2)} 元，订单 ${item.orders}，ROI ${
          item.roi === null ? "--" : item.roi.toFixed(2)
        }，订单成本 ${item.cpa === null ? "--" : item.cpa.toFixed(2)} 元${
          item.netRevenue === null
            ? "，净成交数据未同步"
            : `，净成交 ${item.netRevenue.toFixed(2)} 元，净成交ROI ${
                item.netRoi === null ? "--" : item.netRoi.toFixed(2)
              }，退款率 ${item.refundRate === null ? "--" : (item.refundRate * 100).toFixed(1) + "%"}`
        }，计划 ${item.plans} 个，账户 ${item.accounts} 个，消耗占比 ${(item.share * 100).toFixed(1)}%`,
      );
    }
  }
  lines.push("口径提示: 推广目标只有「推商品」「推直播间」；短视频是创意/素材形式，不是推广目标。");
  lines.push("使用提示: 对比「全域推广 vs 标准推广」「推商品 vs 推直播间」时直接使用拆分，不要声称缺少切片；不要判断绝对盈亏，只评价 ROI、净成交 ROI、目标达成和效率。");
  if (snapshot.orgs.length) {
    lines.push("组织概览（当前层级）:");
    for (const org of snapshot.orgs) {
      lines.push(
        `- ${org.name}: ${org.accounts} 个账户，消耗 ${org.cost.toFixed(2)} 元，支付金额 ${org.revenue.toFixed(
          2,
        )} 元，成交订单 ${org.orders}，整体支付ROI ${org.roi === null ? "--" : org.roi.toFixed(2)}，订单成本 ${
          org.cpa === null ? "--" : org.cpa.toFixed(2)
        } 元`,
      );
    }
  }
  if (snapshot.topAccounts.length) {
    lines.push("Top 账户（按统计周期消耗排序）:");
    for (const account of snapshot.topAccounts) {
      lines.push(
        `- ${account.name}（账户ID: ${account.id}）消耗 ${account.cost.toFixed(2)} 元，整体支付ROI ${
          account.roi === null ? "--" : account.roi.toFixed(2)
        }`,
      );
    }
  }
  if (selectedHint) lines.push(`当前选择: ${selectedHint}`);
  lines.push("说明: 以上均为本地生成的模拟数据，用于产品演示，不代表真实投放结果。");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export default function WorkspaceView() {
  const toast = useToast();
  const {
    snapshot,
    setSnapshot,
    runAction,
    setActiveTab,
    startPartnerTask,
    role,
    operations,
    addOperation,
    refreshOperations,
    productThreads,
    activeProductThreadId,
    openProductThread,
    closeProductThread,
    requestProductThread,
    pendingDraft,
    setPendingDraft,
    pendingProductId,
    setPendingProductId,
    createProductThread,
  } = useWorkbench();
  const chat = useAgentChat();
  const [draft, setDraft] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [sessionFilter, setSessionFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [workspaceDecisions, setWorkspaceDecisions] = useState<AdDecision[]>([]);
  const [workspaceAsk, setWorkspaceAsk] = useState("");
  const [proposalBusy, setProposalBusy] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const creatingThreadRef = useRef<string | null>(null);
  const restoredSessionRef = useRef(false);
  const pendingSendRef = useRef<{ text: string; threadId: string } | null>(null);

  useEffect(() => {
    if (!pendingDraft) return;
    setDraft(pendingDraft);
    setPendingDraft(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [pendingDraft, setPendingDraft]);

  const messages = chat.activeSession?.messages ?? [];
  const activeSession = chat.activeSession;
  const activeThread = productThreads.find((thread) => thread.id === activeProductThreadId) ?? null;
  const pendingProduct = pendingProductId ? PRODUCTS.find((item) => item.id === pendingProductId) ?? null : null;
  const productScope = useMemo(
    () => (activeThread ? getProductScopeForThread(activeThread) : null),
    [activeThread],
  );
  const productPlanRows = useMemo(
    () =>
      productScope
        ? productScope.campaigns.map((campaign) => ({
            campaign,
            totals: sumSeries(campaign.daily, productScope.range),
          }))
        : [],
    [productScope],
  );
  const productTotals = useMemo(
    () =>
      productPlanRows.reduce(
        (acc, row) => {
          acc.cost += row.totals.cost;
          acc.revenue += row.totals.revenue;
          acc.orders += row.totals.orders;
          acc.show += row.totals.show;
          acc.click += row.totals.click;
          return acc;
        },
        { cost: 0, revenue: 0, orders: 0, show: 0, click: 0 },
      ),
    [productPlanRows],
  );
  const threadHealth = productScope ? dataHealthOf(productScope.account) : null;
  const workspaceSessions = useMemo(
    () =>
      activeThread
        ? chat.sessions
            .filter((session) => session.threadId === activeThread.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [activeThread, chat.sessions],
  );
  const threadSession =
    activeThread && activeSession?.threadId === activeThread.id
      ? activeSession
      : workspaceSessions[0];

  const contextText = useMemo(
    () =>
      productScope && activeThread
        ? buildProductContext(productScope, operations, role, threadSession?.summary)
        : buildContextText(snapshot),
    [productScope, activeThread, operations, role, snapshot, threadSession?.summary],
  );

  const contextUsage = useMemo(() => {    if (!activeThread) return null;
    const messageTokens = messages.reduce(
      (sum, message) =>
        sum +
        estimateTokens(message.text) +
        estimateTokens(message.reasoning ?? "") +
        (message.steps ?? []).reduce((stepSum, step) => stepSum + estimateTokens(step.result ?? ""), 0),
      0,
    );
    const tokens = estimateTokens(contextText) + messageTokens;
    const percent = Math.min(100, Math.round((tokens / WORKSPACE_CONTEXT_BUDGET) * 100));
    return {
      tokens,
      percent,
      level: percent >= 90 ? "danger" : percent >= 80 ? "warn" : percent >= 60 ? "notice" : "ok",
    };
  }, [activeThread, contextText, messages]);

  const pendingWorkspaceDecisions = workspaceDecisions.filter((decision) => decision.status === "pending");
  const hasHitl = Boolean(activeThread && (proposalBusy || pendingWorkspaceDecisions.length > 0 || workspaceAsk));

  useEffect(() => {
    if (!hasHitl) return;
    requestAnimationFrame(() => {
      const element = threadRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }, [hasHitl, workspaceDecisions.length, workspaceAsk]);

  const startWorkspaceConversation = () => {
    if (!activeThread) return;
    const summary = summarizeSession(threadSession);
    chat.newSession({
      title: activeThread.title,
      threadId: activeThread.id,
      productId: activeThread.productId,
      summary,
      forceNew: true,
    });
    setDraft("");
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  useEffect(() => {
    if (!activeThread) {
      creatingThreadRef.current = null;
      return;
    }
    if (threadSession) {
      creatingThreadRef.current = null;
      if (chat.activeId !== threadSession.id) chat.selectSession(threadSession.id);
      return;
    }
    if (creatingThreadRef.current === activeThread.id) return;
    creatingThreadRef.current = activeThread.id;
    chat.newSession({
      title: activeThread.title,
      threadId: activeThread.id,
      productId: activeThread.productId,
    });
  }, [activeThread, threadSession, chat.activeId, chat.newSession, chat.selectSession]);

  useEffect(() => {
    if (restoredSessionRef.current) return;
    if (!activeSession) return;
    restoredSessionRef.current = true;
    if (!activeSession.threadId) return;
    if (!productThreads.some((thread) => thread.id === activeSession.threadId)) return;
    if (activeProductThreadId !== activeSession.threadId) openProductThread(activeSession.threadId);
  }, [activeSession?.id, activeSession?.threadId, activeProductThreadId, productThreads, openProductThread]);

  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    if (stickRef.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    stickRef.current = true;
    const element = threadRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.activeId]);

  // Keep the newest content visible while the answer grows (streaming, tool cards, action cards).
  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    const inner = element.querySelector(".thread-inner");
    if (!inner) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [messages.length > 0]);

  useEffect(() => {
    setWorkspaceDecisions([]);
    setWorkspaceAsk("");
    if (!activeThread) return;
    let alive = true;
    void getDecisions({ workspaceId: activeThread.id, status: "pending" })
      .then((data) => {
        if (alive) setWorkspaceDecisions(data.decisions);
      })
      .catch(() => {
        /* partner service offline */
      });
    return () => {
      alive = false;
    };
  }, [activeThread?.id]);

  const sendText = async (text: string) => {
    if (activeThread && contextUsage?.level === "danger") {
      toast("当前会话上下文已接近上限，请先「新对话（保留摘要）」再继续。", "warn");
      return;
    }
    const previousAssistant =
      [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim())?.text ?? "";
    setDraft("");
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    stickRef.current = true;
    await chat.send(text, { context: contextText, includeContext: activeThread ? true : includeContext });

    if (!activeThread || !productScope || !hasExecutionIntent(text)) return;
    setProposalBusy(true);
    setWorkspaceAsk("");
    try {
      const result = await proposeWorkspaceActions({
        workspaceId: activeThread.id,
        productId: activeThread.productId,
        message: text,
        assistantText: previousAssistant,
        permission: activeThread.permission,
        runId: `workspace_${activeThread.id}_${activeSession?.id ?? "none"}`,
      });
      if (result.ok) {
        setWorkspaceDecisions((prev) => {
          const merged = [...prev];
          for (const decision of result.decisions) {
            if (!merged.some((item) => item.id === decision.id)) merged.push(decision);
          }
          return merged;
        });
        setWorkspaceAsk(result.ask ?? "");
      } else {
        setWorkspaceAsk(result.error ?? "执行提案生成失败");
      }
    } catch (error) {
      setWorkspaceAsk(error instanceof Error ? error.message : "执行提案生成失败");
    } finally {
      setProposalBusy(false);
      requestAnimationFrame(() => {
        if (stickRef.current && threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
      });
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || chat.busy) return;
    if (pendingProductId && (!activeThread || activeThread.productId !== pendingProductId)) {
      const thread = createProductThread({ productId: pendingProductId, permission: "suggest" });
      if (!thread) {
        toast("该商品暂时不能创建助手，请确认商品有推广计划", "warn");
        return;
      }
      pendingSendRef.current = { text, threadId: thread.id };
      setDraft("");
      setPendingProductId(null);
      return;
    }
    await sendText(text);
  };

  useEffect(() => {
    const pending = pendingSendRef.current;
    if (!pending) return;
    if (!activeThread || activeThread.id !== pending.threadId) return;
    if (!threadSession || threadSession.threadId !== activeThread.id) return;
    pendingSendRef.current = null;
    void sendText(pending.text);
  }, [activeThread, threadSession, sendText]);

  const handleWorkspaceApprove = async (decision: AdDecision, comment: string) => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    try {
      const result = await approveDecision(decision.id, comment);
      if (!result.ok) {
        toast(result.error ?? "确认失败", "warn");
        return;
      }
      setWorkspaceDecisions((prev) =>
        prev.map((item) => (item.id === result.decision.id ? result.decision : item)),
      );
      if (result.operation) addOperation(result.operation);
      await refreshOperations();
      toast("已确认并执行，可在操作审计中撤销", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "确认失败", "warn");
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleWorkspaceReject = async (decision: AdDecision, comment: string) => {
    if (decisionBusy) return;
    setDecisionBusy(true);
    try {
      const result = await rejectDecision(decision.id, comment);
      if (!result.ok) {
        toast(result.error ?? "拒绝失败", "warn");
        return;
      }
      setWorkspaceDecisions((prev) =>
        prev.map((item) => (item.id === result.decision.id ? result.decision : item)),
      );
      toast("已拒绝该动作，不会执行", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : "拒绝失败", "warn");
    } finally {
      setDecisionBusy(false);
    }
  };

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    if (deepMode) {
      if (activeThread) {
        toast("智能助手已支持执行提案；需要多专家深度执行时交给伙伴团队。", "info");
        return;
      }
      setDraft("");
      const element = composerRef.current;
      if (element) element.style.height = "auto";
      startPartnerTask(text);
      return;
    }
    void handleSend();
  };

  const handleApplyAction = (action: AgentAction) => {
    runAction(action);
  };

  const startNewChat = () => {
    setPendingProductId(null);
    if (activeThread) {
      startWorkspaceConversation();
      return;
    }
    closeProductThread();
    chat.newSession();
    setDraft("");
    setDeepMode(false);
    const element = composerRef.current;
    if (element) {
      element.style.height = "auto";
      requestAnimationFrame(() => element.focus());
    }
  };

  const openGeneralSession = (sessionId: string) => {
    closeProductThread();
    chat.selectSession(sessionId);
  };

  const handleOpenThread = (threadId: string) => {
    openProductThread(threadId);
  };

  const handleRequestThread = (productId: string) => {
    requestProductThread(productId);
  };

  const filteredSessions = useMemo(() => {
    const list = [...chat.sessions]
      .filter((session) => !session.threadId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const query = sessionFilter.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (session) =>
        session.title.toLowerCase().includes(query) ||
        session.messages.some((message) => message.text.toLowerCase().includes(query)),
    );
  }, [chat.sessions, sessionFilter]);

  const viewLabel = activeThread && productScope
    ? `${productScope.orgName} · ${productScope.account.name} · ${productScope.product.name}`
    : snapshot
      ? `${snapshot.channel === "auction" ? "竞价投放" : "品牌投放"} · ${snapshot.dimensionLabel}`
      : "未打开看板";
  const composerViewLabel = activeThread && productScope
    ? `${productScope.product.name} · ${describeRange(productScope.range)}`
    : snapshot
      ? `${viewLabel} · ${describeRange(snapshot.range)}`
      : "未打开看板";

  return (
    <div className="workspace-view">
      {/* ---------------- sidebar ---------------- */}
      <aside className={`ws-sidebar ${recentCollapsed ? "is-recent-collapsed" : ""}`}>
        <div className="ws-sidebar-head">
          <button type="button" className="new-chat-btn" onClick={startNewChat}>
            <MessageSquarePlus size={15} /> 新建对话
          </button>
          <button type="button" className="ws-team-entry" onClick={() => setActiveTab("partner")}>
            <span className="ws-team-icon"><Users size={14} /></span>
            <span className="ws-team-text">
              <b>GetMore团队</b>
              <span>大模型规划 · 工具与技能</span>
            </span>
            <ArrowUpRight size={13} />
          </button>
          <div className="ws-search">
            <div className="input-shell">
              <Search size={13} />
              <input
                placeholder="搜索历史对话"
                value={sessionFilter}
                onChange={(event) => setSessionFilter(event.target.value)}
                aria-label="搜索历史对话"
              />
            </div>
          </div>
        </div>

        <div className="ws-sidebar-scroll">
          <div className="ws-list-head ws-product-head">
            智能助手 <span className="count">{productThreads.length}</span>
          </div>
          <ProductTree
            threads={productThreads}
            activeThreadId={activeProductThreadId}
            onRequestThread={handleRequestThread}
            onOpenThread={handleOpenThread}
          />
          <div className="ws-list-head">
            最近对话 <span className="count">{filteredSessions.length}</span>
            <button
              type="button"
              className="ws-collapse-btn"
              aria-label={recentCollapsed ? "展开最近对话" : "收起最近对话"}
              title={recentCollapsed ? "展开最近对话" : "收起最近对话"}
              onClick={() => setRecentCollapsed((prev) => !prev)}
            >
              {recentCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {!recentCollapsed && (
          <div className="ws-sessions">
          {filteredSessions.map((session) => {
            return (
              <div
                key={session.id}
                className={`session-item ${session.id === chat.activeId ? "is-active" : ""}`}
                onClick={() => openGeneralSession(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openGeneralSession(session.id);
                }}
              >
                <div className="session-title">
                  <Sparkles size={12} style={{ color: "var(--violet)", flexShrink: 0 }} />
                  <span>{session.title || "新对话"}</span>
                </div>
                <div className="session-meta">
                  <span>{relativeTime(session.updatedAt)}</span>
                  <span className="dot" />
                  <span>{session.messages.length} 条消息</span>
                </div>
                <div className="session-actions">
                  <button
                    type="button"
                    className="danger"
                    aria-label="删除对话"
                    onClick={(event) => {
                      event.stopPropagation();
                      chat.deleteSession(session.id);
                      toast("已删除本地对话", "info");
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
          {filteredSessions.length === 0 && (
            <div className="ws-session-empty">没有匹配的对话</div>
          )}
        </div>
        )}

        </div>

        <div className="ws-sidebar-foot">
          <button type="button" className="agent-status" onClick={() => setSettingsOpen((prev) => !prev)}>
            <span className={`status-dot ${chat.status === "online" ? "online" : chat.status === "connecting" ? "checking" : "offline"}`} />
            <span className="status-meta">
              <span className="status-title">
                {chat.status === "online" ? "Nanobot 已连接" : chat.status === "connecting" ? "正在连接…" : "Nanobot 未连接"}
              </span>
              <span className="status-sub">{chat.model} · 本地网关 8765</span>
            </span>
            <span className="status-settings">
              <Settings2 size={14} />
            </span>
          </button>
        </div>

        {settingsOpen && (
          <>
            <div className="click-catcher" onClick={() => setSettingsOpen(false)} />
            <div className="agent-settings" style={{ bottom: 70 }}>
              <h4>本地 Nanobot 网关</h4>
              <p className="hint">
                工作台通过 Vite 代理连接 <code>127.0.0.1:8765</code>，Agent 的会话与记忆保存在本地
                <code>.runtime/nanobot-home</code>。
              </p>
              <div className="settings-status">
                <span className={`status-dot ${chat.status === "online" ? "online" : "offline"}`} />
                {chat.status === "online" ? `已连接 · ${chat.model}` : chat.status === "connecting" ? "连接中…" : "未连接"}
              </div>
              {chat.connectionError && <div className="settings-error">{chat.connectionError}</div>}
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm btn-block" onClick={() => chat.reconnect()}>
                  <RefreshCw size={12} /> 重新连接
                </button>
              </div>
              <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                启动命令：<code>npm run agent</code>
              </p>
            </div>
          </>
        )}
      </aside>

      {/* ---------------- main ---------------- */}
      <main className="ws-main">
        <div className="ws-topbar">
          <div className="ws-title-block">
            <div className="ws-title">
              <span className="ws-title-text">
                {activeThread && productScope ? productScope.product.name : activeSession?.title || "新的对话"}
              </span>
            </div>
            <div className="ws-subtitle">
              <span className="live">
                <span className={`status-dot ${chat.status === "online" ? "online" : "offline"}`} style={{ width: 5, height: 5 }} />
                {chat.status === "online" ? "在线" : chat.status === "connecting" ? "连接中" : "离线"}
              </span>
              <span>·</span>
              <span>基于本地模拟数据</span>
              <span>·</span>
              {activeThread && (
                <span className="thread-scope-chip">
                  <Package size={10} /> 智能助手
                </span>
              )}
              <span>{viewLabel}</span>
            </div>
          </div>

          <div className="ws-topbar-actions">
            {activeThread && (
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => {
                  closeProductThread();
                  chat.newSession();
                }}
              >
                退出助手
              </button>
            )}
            <span className="model-chip">
              <span className="spark">
                <Sparkles size={11} />
              </span>
              {chat.model}
            </span>
          </div>
        </div>

        {activeThread && (
          <div className="workspace-toolbar">
            <div className="workspace-toolbar-scope">
              <Package size={12} />
              <span>{viewLabel}</span>
            </div>
            <div className="workspace-toolbar-actions">
              <Select
                value={threadSession?.id ?? ""}
                options={
                  workspaceSessions.length
                    ? workspaceSessions.map((session) => ({ value: session.id, label: session.title }))
                    : [{ value: "", label: "新对话" }]
                }
                onChange={(value) => {
                  if (value) chat.selectSession(value);
                }}
                width={230}
                ariaLabel="切换工作区对话"
              />
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={startWorkspaceConversation}
                title="在当前工作区新开一段对话，保留工作区上下文与摘要"
              >
                <MessageSquarePlus size={12} /> 新对话
              </button>
              {contextUsage && (
                <span
                  className={`workspace-context-meter ${contextUsage.level}`}
                  title={`上下文约 ${contextUsage.tokens.toLocaleString()} / ${WORKSPACE_CONTEXT_BUDGET.toLocaleString()} tokens`}
                >
                  <span>上下文</span>
                  <b>{contextUsage.percent}%</b>
                  <span className="meter">
                    <i style={{ width: `${contextUsage.percent}%` }} />
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        {chat.status !== "online" && (
          <div className="offline-banner">
            {chat.status === "connecting" ? (
              <>
                <Loader2 size={14} className="spin" />
                <span>正在连接本地 Nanobot 网关…</span>
              </>
            ) : (
              <>
                <AlertTriangle size={14} />
                <span>Nanobot 网关未连接，Copilot 暂时无法回答。</span>
                <code>npm run agent</code>
                <span>启动后点击重试。</span>
                <span className="spacer" />
                <button type="button" className="btn btn-default btn-sm" onClick={() => chat.reconnect()}>
                  <RefreshCw size={12} /> 重试
                </button>
              </>
            )}
          </div>
        )}

        {activeThread && contextUsage && contextUsage.percent >= 60 && (
          <div className={`workspace-context-banner ${contextUsage.level}`}>
            <AlertTriangle size={14} />
            <span>
              当前会话上下文已用约 {contextUsage.percent}%（{contextUsage.tokens.toLocaleString()} /{" "}
              {WORKSPACE_CONTEXT_BUDGET.toLocaleString()} tokens）
              {contextUsage.percent >= 90
                ? "，已达到上限，请新开对话后继续。"
                : "，建议先总结再新开对话，避免上下文过长。"}
            </span>
            <button type="button" className="btn btn-default btn-sm" onClick={startWorkspaceConversation}>
              新对话（保留摘要）
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="ws-empty ws-empty-min" onClick={() => composerRef.current?.focus()}>
            <div className="ws-greeting">
              <span className="ws-greeting-icon">
                <Sparkles size={16} />
              </span>
              <div>
                <div className="ws-greeting-title">
                  {activeThread && productScope ? `${productScope.product.name} · 智能助手` : "有什么可以帮你？"}
                </div>
                <p>
                  {activeThread
                    ? "这个对话只负责该商品的投放：计划表现、预算/出价建议、异常诊断，以及待确认的执行提案。"
                    : "直接问账户表现、预算或计划，我会引用当前看板数据。"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="ws-thread"
            ref={threadRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
            }}
          >
            <div className="thread-inner">
              <div className="thread-date">今天</div>
              {messages.map((message) => (
                <MessageView
                  key={message.id}
                  message={message}
                  onRetry={() => {
                    if (!activeSession) return;
                    void chat.retry(activeSession.id, message.id);
                  }}
                  onApplyAction={handleApplyAction}
                />
              ))}
              {proposalBusy && (
                <div className="ws-hitl-loading">
                  <Loader2 size={13} className="spin" /> 正在检查可执行动作…
                </div>
              )}
              {activeThread && (
                <WorkspaceDecisionPanel
                  decisions={workspaceDecisions}
                  ask={workspaceAsk}
                  busy={decisionBusy}
                  onApprove={handleWorkspaceApprove}
                  onReject={handleWorkspaceReject}
                />
              )}
            </div>
          </div>
        )}

        {activeThread && hasHitl && (
          <div className="ws-hitl-sticky">
            {proposalBusy ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
            <span>
              {proposalBusy
                ? "正在生成执行提案…"
                : pendingWorkspaceDecisions.length > 0
                  ? `${pendingWorkspaceDecisions.length} 个执行提案待确认`
                  : "执行提案需要补充信息"}
            </span>
            <button
              type="button"
              onClick={() => {
                if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
              }}
            >
              查看
            </button>
          </div>
        )}

        <div className="ws-composer-wrap">
          <div className="composer-inner">
            <div className="composer">
              <textarea
                ref={composerRef}
                value={draft}
                rows={1}
                placeholder={
                  activeThread && productScope
                    ? `问「${productScope.product.name}」的投放：为什么 ROI 掉了？预算/出价怎么调？`
                    : deepMode
                      ? "描述经营目标，交给伙伴团队执行：预算重排、停计划、调出价…"
                      : messages.length === 0
                        ? "输入你的第一个问题，例如：今天哪个账户 ROI 最低？"
                        : "让 Copilot 帮你诊断账户、分配预算、写复盘…"
                }
                onChange={(event) => {
                  setDraft(event.target.value);
                  const element = event.currentTarget;
                  element.style.height = "auto";
                  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitDraft();
                  }
                }}
                aria-label={deepMode ? "输入经营目标" : "输入问题"}
              />
              <div className="composer-tools">
                {activeThread ? (
                  <span className="tool-toggle is-on thread-lock" title="智能助手固定在该商品范围；执行提案需你确认后才生效">
                    <ShieldCheck size={12} />
                    固定商品范围
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`tool-toggle ${deepMode ? "is-on" : ""}`}
                    onClick={() => setDeepMode((prev) => !prev)}
                    aria-pressed={deepMode}
                    title="交给伙伴团队：多专家拆解目标，预算 / 暂停 / 出价需你确认后执行"
                  >
                    <Users size={12} />
                    深度执行
                  </button>
                )}
                <button
                  type="button"
                  className={`tool-toggle ${activeThread || includeContext ? "is-on" : ""}`}
                  onClick={() => {
                    if (activeThread) return;
                    setIncludeContext((prev) => !prev);
                  }}
                  aria-pressed={activeThread ? true : includeContext}
                  title={activeThread ? "智能助手始终携带该商品的固定范围上下文" : "发送时附带当前看板的维度、周期与 KPI"}
                >
                  <Database size={12} />
                  {activeThread ? "商品上下文" : "当前视图"}
                </button>
                <span className="composer-view-label">{composerViewLabel}</span>
                {pendingProduct && (
                  <span className="composer-pending-product">发送后绑定：{pendingProduct.name}</span>
                )}
                <span className="spacer" />
                <button type="button" className="tool-toggle" onClick={() => setActiveTab("data")} title="打开数据看板">
                  <BarChart3 size={12} />
                  看板
                </button>
                {chat.busy ? (
                  <button type="button" className="send-btn stop" onClick={() => chat.stop()} aria-label="停止生成" title="停止生成">
                    <Square size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="send-btn"
                    disabled={!draft.trim() || (!deepMode && chat.status !== "online")}
                    onClick={submitDraft}
                    aria-label={deepMode ? "交给伙伴团队" : "发送"}
                    title={deepMode ? "交给伙伴团队" : "发送"}
                  >
                    <SendHorizontal size={15} />
                  </button>
                )}
              </div>
            </div>
            <div className="composer-hint">
              {activeThread ? (
                <>智能助手 · 只分析该商品 · 执行提案需确认 · 当前为本地模拟数据</>
              ) : deepMode ? (
                <>Enter 交给团队 · 提案需确认 · 结束后可在「工作痕迹」复盘</>
              ) : (
                <>
                  <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行 · 数据为模拟数据
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ---------------- context panel ---------------- */}
      <aside className="ws-context">
        {activeThread && productScope ? (
          <>
            <div className="ctx-head">
              <span className="live-dot" />
              智能助手上下文
              <span className="tag tag-outline" style={{ marginLeft: "auto", height: 18, fontSize: 10 }}>
                固定范围
              </span>
            </div>

            <div className="ctx-card thread-ctx-card">
              <div className="ctx-view">
                <span className="ctx-view-icon">
                  <Package size={14} />
                </span>
                <div className="ctx-view-main">
                  <div className="ctx-view-title">{productScope.product.name}</div>
                  <div className="ctx-view-sub">
                    {productScope.orgName} · {productScope.account.name}
                  </div>
                </div>
                <span className="thread-ctx-status">{productScope.product.status}</span>
              </div>
              <div className="ctx-rows">
                <div className="ctx-row">
                  <span className="k">计划数</span>
                  <span className="v num">{productScope.campaigns.length} 条</span>
                </div>
                <div className="ctx-row">
                  <span className="k">库存</span>
                  <span className="v num">{productScope.product.stock}</span>
                </div>
                <div className="ctx-row">
                  <span className="k">助手权限</span>
                  <span className="v">{productScope.thread.permission === "read" ? "只读分析" : "分析 + 提案"}</span>
                </div>
                <div className="ctx-row">
                  <span className="k">统计周期</span>
                  <span className="v">{describeRange(productScope.range)}</span>
                </div>
              </div>
              <div className="ctx-actions">
                <button type="button" className="ctx-btn ghost" onClick={() => setActiveTab("data")}>
                  <ArrowUpRight size={12} /> 打开看板
                </button>
                <button
                  type="button"
                  className="ctx-btn ghost"
                  onClick={() => {
                    closeProductThread();
                    chat.newSession();
                  }}
                >
                  <X size={12} /> 退出助手
                </button>
              </div>
            </div>

            <div className="ctx-card">
              <div className="ctx-section-title" style={{ padding: "0 0 8px" }}>
                <BarChart3 size={12} /> 商品 KPI · 近 7 天
              </div>
              <div className="ctx-kpi-list">
                <div className="ctx-row">
                  <span className="k">消耗</span>
                  <span className="v num">{fmtMoney(productTotals.cost)}</span>
                </div>
                {productScope.account.channel === "brand" ? (
                  <>
                    <div className="ctx-row">
                      <span className="k">展示 / 点击</span>
                      <span className="v num">{fmtMoney(productTotals.show, 0)} / {fmtMoney(productTotals.click, 0)}</span>
                    </div>
                    <div className="ctx-row">
                      <span className="k">CPM / CTR</span>
                      <span className="v num">
                        {fmtMoney(cpmOf(productTotals), 2)} / {fmtRoi(ctrOf(productTotals))}%
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="ctx-row">
                      <span className="k">支付金额</span>
                      <span className="v num">{fmtMoney(productTotals.revenue)}</span>
                    </div>
                    <div className="ctx-row">
                      <span className="k">ROI / 订单成本</span>
                      <span className="v num">
                        {fmtRoi(productTotals.cost > 0 ? roiOf(productTotals) : null)} / {fmtMoney(cpaOf(productTotals))}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="ctx-card">
              <div className="ctx-section-title" style={{ padding: "0 0 8px" }}>
                <Activity size={12} /> 计划明细
              </div>
              <div className="ctx-mini-list">
                {productPlanRows.map(({ campaign, totals }) => (
                  <div className="ctx-mini-row" key={campaign.id}>
                    <span className="ctx-mini-name" title={campaign.name}>{campaign.name}</span>
                    <span className="ctx-mini-val">{fmtMoney(totals.cost, 0)}</span>
                    <span className="ctx-mini-bar">
                      <span style={{ width: `${Math.max(6, (totals.cost / Math.max(productTotals.cost, 1)) * 100)}%` }} />
                    </span>
                    <span className="ctx-mini-roi">
                      {productScope.account.channel === "brand"
                        ? `CTR ${ctrOf(totals)?.toFixed(2) ?? "--"}%`
                        : `ROI ${fmtRoi(roiOf(totals))}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="ctx-card">
              <div className="ctx-section-title" style={{ padding: "0 0 8px" }}>
                <Database size={12} /> 共享能力
              </div>
              <div className="ctx-rows">
                <div className="ctx-row">
                  <span className="k">工具</span>
                  <span className="v num">{activeThread.toolIds.length} 个</span>
                </div>
                <div className="ctx-row">
                  <span className="k">技能</span>
                  <span className="v num">{activeThread.skillIds.length} 个</span>
                </div>
              </div>
              <div className="ctx-actions">
                <button type="button" className="ctx-btn ghost" onClick={() => setCapabilitiesOpen(true)}>
                  <Wrench size={12} /> 管理绑定
                </button>
              </div>
            </div>

            <div className="ctx-card">
              <div className="ctx-section-title" style={{ padding: "0 0 8px" }}>
                <ShieldCheck size={12} /> 数据与边界
              </div>
              <div className="ctx-rows">
                <div className="ctx-row">
                  <span className="k">数据完整度</span>
                  <span className="v num">{threadHealth ? `${Math.round(threadHealth.completeness * 100)}%` : "--"}</span>
                </div>
                <div className="ctx-row">
                  <span className="k">缺失字段</span>
                  <span className="v">{threadHealth?.missing.length ? threadHealth.missing.join("、") : "无"}</span>
                </div>
              </div>
              <p className="ctx-note">
                本对话只看该商品的 {productScope.campaigns.length} 条计划；不判断绝对盈亏（缺成本/毛利），
                跨商品需求请建立对应商品的助手。
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="ctx-head">
              <span className="live-dot" />
              工作台上下文
              <span className="tag tag-outline" style={{ marginLeft: "auto", height: 18, fontSize: 10 }}>
                实时同步
              </span>
            </div>

        <div className="ctx-card">
          <div className="ctx-view">
            <span className="ctx-view-icon">
              <Database size={14} />
            </span>
            <div className="ctx-view-main">
              <div className="ctx-view-title">{viewLabel}</div>
              <div className="ctx-view-sub">
                {snapshot ? (
                  <div className="ctx-range-wrap">
                    <button type="button" className="ctx-range-btn" onClick={() => setRangeOpen((value) => !value)}>
                      <CalendarDays size={11} /> {describeRange(snapshot.range)}
                    </button>
                    {rangeOpen && (
                      <DateRangePopover
                        range={snapshot.range}
                        onClose={() => setRangeOpen(false)}
                        onApply={(next) => {
                          setSnapshot({ ...snapshot, range: next });
                          setRangeOpen(false);
                          toast("看板数据范围已更新", "success");
                        }}
                      />
                    )}
                  </div>
                ) : (
                  "打开数据看板后同步"
                )}
              </div>
            </div>
          </div>
          <div className="ctx-rows">
            <div className="ctx-row">
              <span className="k">组织范围</span>
              <span className="v">{snapshot?.orgName ?? "全部组织"}</span>
            </div>
            <div className="ctx-row">
              <span className="k">投放方式</span>
              <span className="v">{snapshot?.mode ?? "--"}</span>
            </div>
            <div className="ctx-row">
              <span className="k">账户数</span>
              <span className="v num">{snapshot?.totalCount ?? 0}</span>
            </div>
            <div className="ctx-row">
              <span className="k">当前结果</span>
              <span className="v num">{snapshot?.rowCount ?? 0} 条</span>
            </div>
          </div>
          <div className="ctx-actions">
            <button
              type="button"
              className="ctx-btn primary"
              onClick={() => {
                setDraft("结合当前工作台数据，帮我做一个快速诊断：哪些账户需要优先处理，为什么？");
                composerRef.current?.focus();
              }}
            >
              <Zap size={12} /> 引用到对话
            </button>
            <button type="button" className="ctx-btn ghost" onClick={() => setActiveTab("data")}>
              <ArrowUpRight size={12} /> 打开看板
            </button>
          </div>
        </div>

        {snapshot && snapshot.kpi.length > 0 && (
          <div className="ctx-card">
            <div className="ctx-section-title" style={{ padding: "0 0 8px" }}>
              <BarChart3 size={12} /> 当前 KPI
            </div>
            <div className="ctx-kpi-list">
              {snapshot.kpi.slice(0, 3).map((item) => (
                <div key={item.label} className="ctx-row">
                  <span className="k">{item.label}</span>
                  <span className="v num">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {snapshot && snapshot.topAccounts.length > 0 && (
          <div className="ctx-card">
            <div className="ctx-section-title" style={{ padding: "0 0 10px" }}>
              <Activity size={12} /> 消耗 Top 账户
            </div>
            <div className="ctx-mini-list">
              {snapshot.topAccounts.map((account) => {
                const max = Math.max(...snapshot.topAccounts.map((item) => item.cost), 1);
                return (
                  <div key={account.id} className="ctx-mini-row">
                    <span className="ctx-mini-name" title={account.name}>
                      {account.name}
                    </span>
                    <span className="ctx-mini-val">{fmtMoney(account.cost, 0)}</span>
                    <span className="ctx-mini-bar">
                      <span style={{ width: `${Math.max(6, (account.cost / max) * 100)}%` }} />
                    </span>
                    <span className="ctx-mini-roi">
                      {account.metric ?? `ROI ${fmtRoi(account.roi)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
          </>
        )}
      </aside>
      <ProductThreadModal />
      <WorkspaceCapabilitiesModal
        open={capabilitiesOpen}
        workspace={activeThread}
        onClose={() => setCapabilitiesOpen(false)}
      />
    </div>
  );
}

