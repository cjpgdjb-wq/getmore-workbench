import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, ".runtime", "partner");
const FILE = path.join(DIR, "operations.json");

export const EXECUTION_GUARDRAILS = {
  maxBudgetDeltaPct: 20,
  maxBidDeltaPct: 15,
  minProjectedRoi: 2.5,
  minBalance: 1000,
  maxOperationsPerRun: 3,
  brandBudgetBlocked: true,
};

function read() {
  fs.mkdirSync(DIR, { recursive: true });
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(parsed.operations)) return parsed;
  } catch {
    /* first run */
  }
  return { operations: [] };
}

function write(state) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = `${FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ operations: state.operations.slice(-200) }, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

function uid() {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function listOperations({ runId, includeUndone = false, limit = 50 } = {}) {
  return read()
    .operations.filter(
      (operation) => (!runId || operation.run_id === runId) && (includeUndone || !operation.undone),
    )
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

export function getOperation(id) {
  return read().operations.find((operation) => operation.id === id) ?? null;
}

export function applyOperation({
  runId,
  experimentId = null,
  tool,
  targetType,
  targetId,
  targetName,
  field,
  before,
  after,
  unit = "",
  reason,
  expected = null,
}) {
  const state = read();
  const runOperations = state.operations.filter((operation) => operation.run_id === runId && !operation.undone);
  if (runOperations.length >= EXECUTION_GUARDRAILS.maxOperationsPerRun) {
    return { ok: false, error: `单次任务最多执行 ${EXECUTION_GUARDRAILS.maxOperationsPerRun} 个动作` };
  }
  const operation = {
    id: uid(),
    run_id: runId,
    experiment_id: experimentId,
    tool,
    target_type: targetType,
    target_id: targetId,
    target_name: targetName,
    field,
    before,
    after,
    unit,
    reason: String(reason ?? "").slice(0, 400),
    expected,
    at: Date.now(),
    undone: false,
    undo_at: null,
  };
  state.operations.push(operation);
  write(state);
  return { ok: true, operation };
}

export function undoOperation(id) {
  const state = read();
  const operation = state.operations.find((item) => item.id === id);
  if (!operation) return { ok: false, error: "操作不存在" };
  if (operation.undone) return { ok: true, operation };
  const now = Date.now();
  // 同一目标/字段的后续操作先级联撤销，避免撤销后状态被后续值覆盖。
  const later = state.operations.filter(
    (item) =>
      !item.undone &&
      item.target_type === operation.target_type &&
      item.target_id === operation.target_id &&
      item.field === operation.field &&
      item.at > operation.at,
  );
  for (const item of later) {
    item.undone = true;
    item.undo_at = now;
  }
  operation.undone = true;
  operation.undo_at = now;
  write(state);
  return { ok: true, operation, cascaded: later.map((item) => item.id) };
}

/**
 * 把已执行且未撤销的操作叠加到 mock 数据上，得到"当前真实状态"。
 * 工具查询与前端看板共用同一套操作记录。
 */
export function decorateMock(mock, operations = null) {
  const ops = (operations ?? listOperations({ includeUndone: false })).slice().sort((a, b) => a.at - b.at);
  const accountFields = new Map();
  const planFields = new Map();

  for (const operation of ops) {
    const map = operation.target_type === "account" ? accountFields : planFields;
    const patch = map.get(operation.target_id) ?? {};
    patch[operation.field] = operation.after;
    map.set(operation.target_id, patch);
  }

  const accounts = mock.ACCOUNTS.map((account) =>
    accountFields.has(account.id) ? { ...account, ...accountFields.get(account.id) } : account,
  );
  const campaigns = mock.CAMPAIGNS.map((campaign) =>
    planFields.has(campaign.id) ? { ...campaign, ...planFields.get(campaign.id) } : campaign,
  );
  const brandCampaigns = mock.BRAND_CAMPAIGNS.map((campaign) =>
    planFields.has(campaign.id) ? { ...campaign, ...planFields.get(campaign.id) } : campaign,
  );

  const state = {
    ...mock,
    ACCOUNTS: accounts,
    CAMPAIGNS: campaigns,
    BRAND_CAMPAIGNS: brandCampaigns,
    accountById: (id) => accounts.find((account) => account.id === id),
    accountsOfOrgs: (orgIds, channel) => {
      const set = new Set(orgIds);
      return accounts.filter((account) => set.has(account.orgId) && (!channel || account.channel === channel));
    },
    campaignsOfAccounts: (accountIds, channel) => {
      const set = new Set(accountIds);
      return [...campaigns, ...brandCampaigns].filter(
        (campaign) => set.has(campaign.accountId) && (!channel || campaign.channel === channel),
      );
    },
  };
  return state;
}

/** 给前端用的精简视图（不含 daily 序列）；默认含已撤销，便于审计回看 */
export function operationsView() {
  return listOperations({ includeUndone: true, limit: 100 }).map((operation) => ({ ...operation }));
}
