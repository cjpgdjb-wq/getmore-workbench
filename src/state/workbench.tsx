import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACCOUNTS, BRAND_CAMPAIGNS, CAMPAIGNS, PRODUCTS, type Channel, type DateRange, type Dimension } from "../data/mock";
import type { AdOperation } from "../lib/partner";
import {
  loadProductThreads,
  saveProductThreads,
  threadForProduct,
  type ProductThread,
  type ThreadPermission,
} from "../features/workspace/productThreads";
import { DEFAULT_SKILL_IDS, DEFAULT_TOOL_IDS } from "../features/workspace/assistantRegistry";

export type ActiveTab = "workspace" | "partner" | "data";
export type Role = "pm" | "operator";

export interface MetricSlice {
  key: string;
  label: string;
  cost: number;
  revenue: number;
  orders: number;
  netRevenue: number | null;
  netRoi: number | null;
  refundRate: number | null;
  roi: number | null;
  cpa: number | null;
  plans: number;
  accounts: number;
  share: number;
}

export interface DataHealthSummary {
  completeness: number;
  lastSyncedAt: string;
  lagMinutes: number;
  missing: string[];
  staleAccounts: number;
  partialAccounts: number;
  totalAccounts: number;
}

export interface ViewSnapshot {
  channel: Channel;
  dimension: Dimension;
  dimensionLabel: string;
  range: DateRange;
  mode: string;
  target: string;
  orgName: string | null;
  search: string;
  rowCount: number;
  totalCount: number;
  selectedCount: number;
  kpi: { label: string; value: string }[];
  orgs: { name: string; accounts: number; cost: number; revenue: number; orders: number; roi: number | null; cpa: number | null }[];
  topAccounts: { id: string; name: string; cost: number; roi: number | null; metric?: string }[];
  dataHealth: DataHealthSummary;
  breakdowns: { modes: MetricSlice[]; targets: MetricSlice[] };
  updatedAt: string;
}

export type AgentAction =
  | { type: "set_channel"; channel: Channel }
  | { type: "set_dimension"; dimension: Dimension }
  | { type: "set_mode"; mode: "全域推广" | "标准推广" }
  | { type: "set_target"; target: "全部" | "推商品" | "推直播间" }
  | { type: "set_range"; preset: "today" | "yesterday" | "last7" | "last30" }
  | { type: "set_search"; query: string }
  | { type: "filter_low_balance" }
  | { type: "open_account"; accountId: string };

interface WorkbenchContextValue {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  snapshot: ViewSnapshot | null;
  setSnapshot: (snapshot: ViewSnapshot) => void;
  pendingAction: AgentAction | null;
  runAction: (action: AgentAction) => void;
  consumeAction: () => AgentAction | null;
  /** 统一入口：从工作台输入框交给伙伴团队执行 */
  partnerGoal: string | null;
  startPartnerTask: (goal: string) => void;
  consumePartnerGoal: () => string | null;
  /** 商品对话预填：GetMore 只填输入框，不自动开跑，也不提前创建商品对话 */
  pendingDraft: string | null;
  setPendingDraft: (text: string | null) => void;
  pendingProductId: string | null;
  setPendingProductId: (productId: string | null) => void;
  /** 演示视角：产品经理可标记 Badcase，优化师只能反馈问题 */
  role: Role;
  setRole: (role: Role) => void;
  /** Agent 直接执行的投放操作（跨看板/伙伴共享） */
  operations: AdOperation[];
  addOperation: (operation: AdOperation) => void;
  refreshOperations: () => Promise<void>;
  /** 智能助手：一个商品一个固定范围的对话 */
  productThreads: ProductThread[];
  activeProductThreadId: string | null;
  threadCandidateProductId: string | null;
  requestProductThread: (productId: string) => void;
  createProductThread: (input: { productId: string; permission: ThreadPermission }) => ProductThread | null;
  updateProductThread: (threadId: string, patch: Partial<Pick<ProductThread, "permission" | "toolIds" | "skillIds">>) => void;
  openProductThread: (threadId: string) => void;
  closeProductThread: () => void;
  clearThreadCandidate: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("workspace");
  const [snapshot, setSnapshotState] = useState<ViewSnapshot | null>(null);
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);
  const pendingRef = useRef<AgentAction | null>(null);
  const [partnerGoal, setPartnerGoal] = useState<string | null>(null);
  const partnerGoalRef = useRef<string | null>(null);
  const [pendingDraft, setPendingDraftState] = useState<string | null>(null);
  const [pendingProductId, setPendingProductIdState] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("operator");
  const [operations, setOperations] = useState<AdOperation[]>([]);
  const [productThreads, setProductThreads] = useState<ProductThread[]>(loadProductThreads);
  const [activeProductThreadId, setActiveProductThreadId] = useState<string | null>(null);
  const [threadCandidateProductId, setThreadCandidateProductId] = useState<string | null>(null);

  useEffect(() => {
    saveProductThreads(productThreads);
  }, [productThreads]);

  const requestProductThread = useCallback((productId: string) => {
    setThreadCandidateProductId(productId);
    setActiveTab("workspace");
  }, []);

  const clearThreadCandidate = useCallback(() => setThreadCandidateProductId(null), []);

  const openProductThread = useCallback((threadId: string) => {
    setActiveProductThreadId(threadId);
    setThreadCandidateProductId(null);
    setActiveTab("workspace");
  }, []);

  const updateProductThread = useCallback(
    (threadId: string, patch: Partial<Pick<ProductThread, "permission" | "toolIds" | "skillIds">>) => {
      setProductThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread)),
      );
    },
    [],
  );

  const closeProductThread = useCallback(() => setActiveProductThreadId(null), []);

  const createProductThread = useCallback(
    ({ productId, permission }: { productId: string; permission: ThreadPermission }) => {
      if (role !== "operator") return null;
      const existing = threadForProduct(productThreads, productId);
      if (existing) {
        setActiveProductThreadId(existing.id);
        setThreadCandidateProductId(null);
        setActiveTab("workspace");
        return existing;
      }
      const product = PRODUCTS.find((item) => item.id === productId);
      const account = product ? ACCOUNTS.find((item) => item.id === product.accountId) : null;
      const campaigns = [...CAMPAIGNS, ...BRAND_CAMPAIGNS].filter((item) => item.productId === productId);
      if (!product || !account || campaigns.length === 0) return null;
      const thread: ProductThread = {
        id: `thread_${productId}_${Date.now().toString(36)}`,
        productId,
        accountId: account.id,
        orgId: account.orgId,
        title: `${product.name} · ${account.name}`,
        createdBy: role,
        createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
        permission,
        toolIds: DEFAULT_TOOL_IDS,
        skillIds: DEFAULT_SKILL_IDS,
      };
      setProductThreads((prev) => [thread, ...prev]);
      setActiveProductThreadId(thread.id);
      setThreadCandidateProductId(null);
      setActiveTab("workspace");
      return thread;
    },
    [role, productThreads],
  );

  const refreshOperations = useCallback(async () => {
    try {
      const response = await fetch("/partner/operations");
      if (!response.ok) return;
      const data = (await response.json()) as { operations?: AdOperation[] };
      if (Array.isArray(data.operations)) setOperations(data.operations);
    } catch {
      /* partner service offline */
    }
  }, []);

  useEffect(() => {
    void refreshOperations();
  }, [refreshOperations]);

  const addOperation = useCallback((operation: AdOperation) => {
    setOperations((prev) => [operation, ...prev.filter((item) => item.id !== operation.id)]);
  }, []);

  const setSnapshot = useCallback((next: ViewSnapshot) => {
    setSnapshotState(next);
  }, []);

  const runAction = useCallback((action: AgentAction) => {
    pendingRef.current = action;
    setPendingAction(action);
    setActiveTab("data");
  }, []);

  const consumeAction = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    setPendingAction(null);
    return action;
  }, []);

  const startPartnerTask = useCallback((goal: string) => {
    const text = goal.trim();
    if (!text) return;
    partnerGoalRef.current = text;
    setPartnerGoal(text);
    setActiveTab("partner");
  }, []);

  const consumePartnerGoal = useCallback(() => {
    const goal = partnerGoalRef.current;
    partnerGoalRef.current = null;
    setPartnerGoal(null);
    return goal;
  }, []);

  const setPendingDraft = useCallback((text: string | null) => {
    setPendingDraftState(text);
  }, []);

  const setPendingProductId = useCallback((productId: string | null) => {
    setPendingProductIdState(productId);
  }, []);

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      snapshot,
      setSnapshot,
      pendingAction,
      runAction,
      consumeAction,
      partnerGoal,
      startPartnerTask,
      consumePartnerGoal,
      pendingDraft,
      setPendingDraft,
      pendingProductId,
      setPendingProductId,
      role,
      setRole,
      operations,
      addOperation,
      refreshOperations,
      productThreads,
      activeProductThreadId,
      threadCandidateProductId,
      requestProductThread,
      createProductThread,
      updateProductThread,
      openProductThread,
      closeProductThread,
      clearThreadCandidate,
    }),
    [
      activeTab,
      snapshot,
      setSnapshot,
      pendingAction,
      runAction,
      consumeAction,
      partnerGoal,
      startPartnerTask,
      consumePartnerGoal,
      pendingDraft,
      setPendingDraft,
      pendingProductId,
      setPendingProductId,
      role,
      operations,
      addOperation,
      refreshOperations,
      productThreads,
      activeProductThreadId,
      threadCandidateProductId,
      requestProductThread,
      createProductThread,
      updateProductThread,
      openProductThread,
      closeProductThread,
      clearThreadCandidate,
    ],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench(): WorkbenchContextValue {
  const context = useContext(WorkbenchContext);
  if (!context) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return context;
}

export function describeRange(range: DateRange): string {
  if (range.start === range.end) return range.start;
  return `${range.start} ~ ${range.end}`;
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  org: "组织总览",
  account: "账户",
  campaign: "推广计划",
};
