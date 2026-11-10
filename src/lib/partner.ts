export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ExpertCatalogItem {
  id: string;
  name: string;
  role: string;
  success: string;
  canWrite: boolean;
  skills: { id: string; name: string; version: string; description: string }[];
  tools: ToolDefinition[];
}

export interface HypothesisObservationMetric {
  label: string;
  value: string;
  hint?: string;
}

export interface HypothesisSegment {
  label: string;
  count: number;
  cost: number;
  roi: number;
  conversions: number;
  note?: string;
}

export interface HypothesisObservation {
  headline: string;
  summary: string;
  metrics: HypothesisObservationMetric[];
  segmentLabel?: string;
  segments: HypothesisSegment[];
  caveat?: string;
}

export interface HypothesisStatement {
  statement: string;
  mechanism: string;
  population: string;
  intervention: string;
  control: string;
  primaryMetric: string;
  guardrail: string;
  horizon: string;
  decisionRule: string;
}

export interface HypothesisStrategyRow {
  group: string;
  condition: string;
  action: string;
  guardrail: string;
}

export interface HypothesisTest {
  method: string;
  unit: string;
  sample: string;
  window: string;
  preRegistration: string;
  risks: string[];
}

export interface HypothesisEvalCase {
  id: string;
  goal: string;
  expected: string;
}

export interface HypothesisProductization {
  tool: string;
  skill: string;
  evalCases: HypothesisEvalCase[];
}

export interface HypothesisEvidenceMetric {
  key: string;
  label: string;
  treatment: number;
  control: number;
  effect: number;
  unit: string;
  effectUnit?: string;
  better: "higher" | "lower";
  p: number | null;
  ci?: [number, number];
}

export interface HypothesisGuardrail {
  label: string;
  value: number;
  treatment: number;
  control: number;
  threshold: number;
  unit: string;
  pass: boolean;
}

export type HypothesisStatus = "draft" | "validated" | "inconclusive" | "rejected";

export interface HypothesisEvidence {
  synthetic: boolean;
  ranAt: number;
  sample: { treatment: number; control: number; unit: string; pairs?: number };
  metrics: HypothesisEvidenceMetric[];
  guardrails: HypothesisGuardrail[];
  verdict: HypothesisStatus;
  verdictLabel: string;
  confidence: "high" | "medium" | "low";
  summary: string;
  caveat: string;
}

export interface HypothesisCard {
  id: string;
  shortTitle: string;
  title: string;
  question: string;
  tags: string[];
  impact: string;
  baseConfidence: "high" | "medium" | "low";
  observation: HypothesisObservation;
  hypothesis: HypothesisStatement;
  strategy: HypothesisStrategyRow[];
  test: HypothesisTest;
  productization: HypothesisProductization;
  status: HypothesisStatus;
  statusLabel: string;
  statusTone: "green" | "orange" | "red" | "gray";
  confidence: "high" | "medium" | "low";
  confidenceLabel: string;
  trialCount: number;
  evidence: HypothesisEvidence | null;
  updatedAt: number | null;
}

export interface HypothesisLibrary {
  hypotheses: HypothesisCard[];
  summary: {
    total: number;
    validated: number;
    inconclusive: number;
    rejected: number;
    draft: number;
    trials: number;
    synthetic: boolean;
  };
  generatedAt: number;
  caveat: string;
}

export interface ExperimentMetric {
  label: string;
  value: string;
}

export interface ExperimentAction {
  type: "budget" | "observe";
  targetType: "account" | "plan";
  targetId: string;
  targetName: string;
  field: "budget" | "status";
  before: number | string;
  after: number | string;
  unit: string;
  deltaPct?: number;
  tool: string;
  actionLabel: string;
}

export interface ExperimentExpected {
  label?: string;
  value?: number | null;
  unit?: string;
  text?: string;
}

export interface ExperimentScope {
  accountId: string;
  accountName: string;
  planIds: string[];
  planName: string | null;
}

export interface ExperimentBaseline {
  roi: number;
  cost7d: number;
  orders7d: number;
  conversions: number;
  planBudget: number | null;
  accountBudget: number;
  pacing?: number;
  capturedAt: number;
}

export interface ExperimentRecommendation {
  id: string;
  templateId: string;
  templateLabel: string;
  category: string;
  title: string;
  question: string;
  scope: ExperimentScope;
  scopeLine: string;
  dataWindow: { start: string; end: string; days: number; label: string } | null;
  situation: string[];
  metrics: ExperimentMetric[];
  rationale: string[];
  suggestion: string;
  criteria: string;
  guardrail: string;
  action: ExperimentAction;
  expected: ExperimentExpected;
  riskLevel: "low" | "medium" | "high";
  riskText: string;
  costCap: number;
  costCapUnit: string;
  durationDays: number;
  score: number;
  impact: "高" | "中" | "低";
  confidence: "high" | "medium" | "low";
  confidenceLabel: string;
  sampleAdequate: boolean;
  sampleNote: string;
  dataGaps: string[];
  dataGapDetails: {
    code: string;
    label: string;
    detail: string;
    severity: "blocking" | "warning" | "info";
    blocksStart: boolean;
  }[];
  requiredData: string[];
  canStart: boolean;
  startBlockReason: string | null;
  goal: number;
  baseline: ExperimentBaseline;
}

export interface ExperimentDesign {
  primaryMetric: string;
  guardrail: string;
  criteria: string;
  checkpoints: { day: number; label: string }[];
  sampleAdequate: boolean;
  sampleNote: string;
}

export interface ExperimentReadout {
  simulated: boolean;
  ranAt: number;
  days: number;
  verdict: "positive" | "neutral" | "negative" | "insufficient";
  verdictLabel: string;
  recommendation: "continue" | "expand" | "revert" | "observe";
  confidence: "high" | "medium" | "low";
  confidenceLabel: string;
  plain: string;
  effect: { roi: number; gmv: number };
  stats: {
    baselineRoi: number;
    currentRoi: number;
    roiDelta: number;
    gmvDelta: number;
    days: number;
    sampleAdequate: boolean;
  };
  note: string;
}

export type ExperimentStatus = "pending" | "running" | "concluded" | "reverted" | "cancelled";

export interface Experiment {
  id: string;
  recommendationId: string;
  templateId: string;
  templateLabel: string;
  category: string;
  title: string;
  question: string;
  scope: ExperimentScope;
  scopeLine: string;
  mode: "start" | "observe";
  status: ExperimentStatus;
  decisionId: string | null;
  operationId: string | null;
  baseline: ExperimentBaseline;
  proposal: ExperimentAction & {
    suggestion: string;
    expected: ExperimentExpected;
    costCap: number;
    costCapUnit: string;
    durationDays: number;
  };
  design: ExperimentDesign;
  rationale: string[];
  guardrail: string;
  criteria: string;
  riskLevel: "low" | "medium" | "high";
  riskText: string;
  confidence: "high" | "medium" | "low";
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  readout: ExperimentReadout | null;
  decisionStatus: "pending" | "approved" | "rejected" | "expired" | null;
  operationUndone: boolean;
  progress: { day: number; total: number; percent: number };
  canReadout: boolean;
  canRollback: boolean;
}

export interface ExperimentLibrary {
  experiments: Experiment[];
  recommendations: ExperimentRecommendation[];
  summary: {
    suggested: number;
    pending: number;
    running: number;
    concluded: number;
    total: number;
  };
  generatedAt: number;
  note: string;
}

export interface PartnerHealth {
  ok: boolean;
  model: string;
  provider_ready: boolean;
  memory: { total: number; pending: number; verified: number; preferences: number; accuracy: number | null };
  guardrails: Record<string, number | boolean>;
  experts: { id: string; name: string; role: string; tools: number; canWrite: boolean }[];
}

export interface ExpertPlanItem {
  id: string;
  name: string;
  role: string;
  focus: string;
}

export interface PartnerPlan {
  intent: string;
  experts: ExpertPlanItem[];
  skills?: { id: string; name: string; version: string; reason?: string }[];
  successCriteria: string[];
  assumptions: string[];
}

export interface ContextLayer {
  key: "L1" | "L2" | "L3";
  expertId?: string;
  expertName?: string;
  label: string;
  tokens: number;
  budget: number;
  trimmed?: boolean;
  preview: string;
  content: string;
}

export interface ToolTrace {
  id: string;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  durationMs: number;
}

export interface ExpertResult {
  id: string;
  name: string;
  role: string;
  focus: string;
  finding: string;
  tools: ToolTrace[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latencyMs?: number;
  error?: boolean;
}

export interface AdOperation {
  id: string;
  run_id: string;
  experiment_id?: string | null;
  tool: string;
  target_type: "account" | "plan";
  target_id: string;
  target_name: string;
  field: "status" | "budget" | "bid";
  before: string | number;
  after: string | number;
  unit: string;
  reason: string;
  expected?: { label?: string; value?: number | null; unit?: string; text?: string } | null;
  at: number;
  undone: boolean;
  undo_at: number | null;
}

export interface AdDecision {
  id: string;
  runId: string;
  workspaceId: string | null;
  productId?: string | null;
  accountId?: string | null;
  experimentId?: string | null;
  allowedPlanIds?: string[];
  tool: string;
  action: string;
  targetType: "account" | "plan";
  targetId: string;
  targetName: string;
  field: "status" | "budget" | "bid";
  before: string | number;
  after: string | number;
  unit: string;
  reason: string;
  evidence: string[];
  dataGaps: string[];
  expected?: { label?: string; value?: number | null; unit?: string; text?: string } | null;
  riskLevel: "low" | "medium" | "high";
  riskText: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  comment: string;
  operationId: string | null;
}

export interface MemoryEntry {
  id: string;
  kind: "decision" | "preference" | "outcome";
  scope: string;
  text: string;
  evidence?: string;
  tags?: string[];
  status: "pending" | "verified";
  expected?: { label?: string; value?: number | null; unit?: string; text?: string } | null;
  actual?: { text?: string; value?: number | null; simulated?: boolean } | null;
  verdict?: "correct" | "partial" | "wrong" | null;
  created_at: number;
  run_id?: string | null;
}

export interface Badcase {
  category: string;
  note: string;
  source?: "pm" | "user";
  at: number;
}

export interface PartnerRunSummary {
  id: string;
  goal: string;
  createdAt: number;
  status: string;
  experts: string[];
  latencyMs: number | null;
  operationCount: number;
  decisionCount: number;
  pendingDecisionCount: number;
  undoneCount: number;
  memoryCount: number;
  toolCallCount: number;
  toolFailureCount: number;
  badcase: Badcase | null;
  intent: string;
}

export interface PartnerRunDetail {
  id: string;
  goal: string;
  createdAt: number;
  status: string;
  plan: PartnerPlan;
  range: { start: string; end: string; preset?: string };
  context: { l1: string; layers: ContextLayer[] };
  experts: ExpertResult[];
  synthesis: string;
  operations: AdOperation[];
  decisions?: AdDecision[];
  memories: MemoryEntry[];
  badcase?: Badcase | null;
  usage?: Record<string, unknown>;
  latencyMs?: number;
  view?: Record<string, unknown>;
}

export interface PartnerEvent {
  type: string;
  [key: string]: unknown;
}

const BASE = "/partner";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `请求失败（${response.status}）`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getHealth(): Promise<PartnerHealth> {
  return request<PartnerHealth>("/health");
}

export async function getExpertCatalog(): Promise<{ experts: ExpertCatalogItem[]; guardrails: Record<string, number | boolean> }> {
  return request("/experts");
}

export async function getHypotheses(): Promise<HypothesisLibrary> {
  return request("/hypotheses");
}

export async function replayHypothesis(id: string): Promise<{
  ok: boolean;
  hypothesis: HypothesisCard;
  summary: HypothesisLibrary["summary"];
  error?: string;
}> {
  return request(`/hypotheses/${encodeURIComponent(id)}/replay`, {
    method: "POST",
    body: "{}",
  });
}

export interface ExperimentUsage {
  views: number;
  starts: number;
  actionStarts: number;
  observeStarts: number;
  dismisses: number;
  readouts: number;
  rollbacks: number;
  cancels: number;
  startsPerView: number;
  rollbackRate: number;
  dismissPerView: number;
  diagnosis: string;
  byTemplate: Record<string, { starts: number; readouts: number; rollbacks: number }>;
  note: string;
}

export async function getExperimentUsage(): Promise<ExperimentUsage> {
  return request("/experiments/usage");
}

export async function trackExperimentView(count: number): Promise<{ ok: boolean }> {
  return request("/experiments/view", {
    method: "POST",
    body: JSON.stringify({ count, source: "drawer" }),
  });
}

export interface CapabilitySkill {
  id: string;
  name: string;
  version: string;
  description: string;
  businessProblem?: string;
  designRationale?: string;
  businessMetrics?: string[];
  closedLoop?: string;
  evidence?: string[];
  trigger: string[];
  expertIds: string[];
  toolNames: string[];
  steps: string[];
  output: Record<string, unknown>;
  failure: string;
  instructions: string;
  evalCaseFile: string;
  source?: string;
  updatedAt?: number | null;
}

export interface CapabilityTool {
  id: string;
  name: string;
  description: string;
  expertIds: string[];
  expertNames: string[];
  parameters: Record<string, unknown>;
  canWrite: boolean;
  risk: string;
  handlerId: string | null;
  source: "code" | "imported";
  executable: boolean;
  enabled: boolean;
}

export async function getCapabilitySkills(): Promise<{ skills: CapabilitySkill[] }> {
  return request("/skills");
}

export async function saveCapabilitySkill(skill: CapabilitySkill): Promise<{ ok: boolean; skill: CapabilitySkill }> {
  return request(`/skills/${encodeURIComponent(skill.id)}`, {
    method: "PUT",
    body: JSON.stringify(skill),
  });
}

export async function importCapabilitySkill(skill: CapabilitySkill): Promise<{ ok: boolean; skill: CapabilitySkill }> {
  return request("/skills", {
    method: "POST",
    body: JSON.stringify(skill),
  });
}

export async function deleteCapabilitySkill(id: string): Promise<{ ok: boolean }> {
  return request(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getCapabilityTools(): Promise<{ tools: CapabilityTool[] }> {
  return request("/tools");
}

export async function saveCapabilityTool(
  id: string,
  patch: { description?: string; enabled?: boolean },
): Promise<{ ok: boolean; tool: CapabilityTool }> {
  return request(`/tools/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function importCapabilityTool(input: {
  name: string;
  description: string;
  expertIds: string[];
  parameters?: Record<string, unknown>;
}): Promise<{ ok: boolean; tool: CapabilityTool }> {
  return request("/tools/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCapabilityTool(id: string): Promise<{ ok: boolean }> {
  return request(`/tools/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getExperimentLibrary(scope?: {
  accountId?: string | null;
  planId?: string | null;
}): Promise<ExperimentLibrary> {
  const search = new URLSearchParams();
  if (scope?.accountId) search.set("accountId", scope.accountId);
  if (scope?.planId) search.set("planId", scope.planId);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/experiments${suffix}`);
}

export async function getExperimentRecommendations(): Promise<{
  recommendations: ExperimentRecommendation[];
  total: number;
  generatedAt: number;
}> {
  return request("/experiments/recommendations");
}

export async function startExperiment(
  recommendationId: string,
  mode: "start" | "observe" = "start",
): Promise<{ ok: boolean; experiment: Experiment; error?: string }> {
  return request("/experiments", {
    method: "POST",
    body: JSON.stringify({ recommendationId, mode }),
  });
}

export async function dismissExperimentRecommendation(
  recommendationId: string,
): Promise<{ ok: boolean; dismissed: number }> {
  return request("/experiments/dismiss", {
    method: "POST",
    body: JSON.stringify({ recommendationId }),
  });
}

export async function readoutExperiment(
  id: string,
): Promise<{ ok: boolean; experiment: Experiment; error?: string }> {
  return request(`/experiments/${encodeURIComponent(id)}/readout`, {
    method: "POST",
    body: "{}",
  });
}

export async function stopExperiment(
  id: string,
  rollback = false,
): Promise<{ ok: boolean; experiment: Experiment; error?: string }> {
  return request(`/experiments/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    body: JSON.stringify({ rollback }),
  });
}

export async function rollbackExperiment(
  id: string,
): Promise<{ ok: boolean; experiment: Experiment; error?: string }> {
  return request(`/experiments/${encodeURIComponent(id)}/rollback`, {
    method: "POST",
    body: "{}",
  });
}

export async function getMemory(): Promise<{ stats: PartnerHealth["memory"]; entries: MemoryEntry[] }> {
  return request("/memory");
}

export async function verifyMemory(id: string): Promise<{ ok: boolean; entry: MemoryEntry; error?: string }> {
  return request("/memory/verify", { method: "POST", body: JSON.stringify({ id }) });
}

export async function getRuns(): Promise<{ runs: PartnerRunSummary[] }> {
  return request("/runs");
}

export async function getRun(id: string): Promise<{ run: PartnerRunDetail }> {
  return request(`/runs/${id}`);
}

export async function tagBadcase(
  id: string,
  category: string,
  note: string,
  source: "pm" | "user" = "pm",
): Promise<{ ok: boolean; id: string; badcase: Badcase }> {
  return request(`/runs/${id}/badcase`, {
    method: "POST",
    body: JSON.stringify({ category, note, source }),
  });
}

export async function clearBadcase(id: string): Promise<{ ok: boolean; id: string; badcase: null }> {
  return request(`/runs/${id}/badcase`, { method: "DELETE" });
}

export async function getOperations(): Promise<{ operations: AdOperation[]; guardrails: Record<string, number | boolean> }> {
  return request("/operations");
}

export async function undoOperation(id: string): Promise<{ ok: boolean; operation: AdOperation; error?: string }> {
  return request(`/operations/${id}/undo`, { method: "POST", body: "{}" });
}

export async function getDecisions(params: { runId?: string; workspaceId?: string; status?: string } = {}): Promise<{
  decisions: AdDecision[];
  ttlMinutes: number;
}> {
  const search = new URLSearchParams();
  if (params.runId) search.set("runId", params.runId);
  if (params.workspaceId) search.set("workspaceId", params.workspaceId);
  if (params.status) search.set("status", params.status);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request(`/decisions${suffix}`);
}

export async function proposeWorkspaceActions(input: {
  workspaceId: string;
  productId: string;
  message: string;
  assistantText?: string;
  permission?: "read" | "suggest";
  runId?: string;
}): Promise<{ ok: boolean; decisions: AdDecision[]; ask: string; error?: string }> {
  return request("/workspace/propose", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function approveDecision(id: string, comment = ""): Promise<{
  ok: boolean;
  decision: AdDecision;
  operation?: AdOperation;
  error?: string;
}> {
  return request(`/decisions/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function rejectDecision(id: string, comment = ""): Promise<{
  ok: boolean;
  decision: AdDecision;
  error?: string;
}> {
  return request(`/decisions/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export interface PartnerViewContext {
  channel?: string;
  dimensionLabel?: string;
  range?: { start: string; end: string; preset?: string };
  orgName?: string | null;
  search?: string;
}

export async function streamPartnerRun({
  goal,
  view,
  onEvent,
  signal,
}: {
  goal: string;
  view: PartnerViewContext;
  onEvent: (event: PartnerEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ goal, view }),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    let message = `无法启动任务（${response.status}）`;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      const type = typeof data.type === "string" ? data.type : eventName;
      onEvent({ ...data, type });
    }
  }
}
