import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), ".runtime", "partner", "experiment-events.json");
const MAX_EVENTS = 5000;
const TYPES = new Set(["view", "start_action", "start_observe", "dismiss", "readout", "rollback", "cancel"]);

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { events: Array.isArray(parsed.events) ? parsed.events : [] };
  } catch {
    return { events: [] };
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2), "utf8");
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function recordExperimentEvent({ type, count = 0, experimentId = null, recommendationId = null, templateId = null, mode = null, source = null }) {
  if (!TYPES.has(type)) throw new Error(`unknown experiment event: ${type}`);
  const store = readStore();
  const event = {
    id: uid("evt"),
    type,
    at: Date.now(),
    count: Math.max(0, Number(count) || 0),
    experimentId,
    recommendationId,
    templateId,
    mode,
    source,
  };
  store.events.push(event);
  if (store.events.length > MAX_EVENTS) store.events = store.events.slice(-MAX_EVENTS);
  writeStore(store);
  return event;
}

export function getExperimentUsage() {
  const { events } = readStore();
  const count = (type) => events.filter((event) => event.type === type).length;
  const views = count("view");
  const actionStarts = count("start_action");
  const observeStarts = count("start_observe");
  const starts = actionStarts + observeStarts;
  const dismisses = count("dismiss");
  const readouts = count("readout");
  const rollbacks = count("rollback");
  const cancels = count("cancel");

  const byTemplate = {};
  for (const event of events) {
    if (!event.templateId) continue;
    const entry = (byTemplate[event.templateId] ??= { starts: 0, readouts: 0, rollbacks: 0 });
    if (event.type === "start_action" || event.type === "start_observe") entry.starts += 1;
    if (event.type === "readout") entry.readouts += 1;
    if (event.type === "rollback") entry.rollbacks += 1;
  }

  const rollbackRate = starts > 0 ? rollbacks / starts : 0;
  let diagnosis = "使用正常，继续观察。";
  if (views === 0) {
    diagnosis = "还没有打开记录；打开一次即开始记录。";
  } else if (starts >= 2 && rollbackRate >= 0.3) {
    diagnosis = `回滚偏多（${rollbacks}/${starts} 次）：先收紧动作幅度或护栏。`;
  } else if (views < 3) {
    diagnosis = `样本还少（打开 ${views} 次），再积累几次再判断。`;
  } else if (starts === 0) {
    diagnosis = "打开多、开始少：先看推荐依据是否可信。";
  } else if (starts / views >= 0.5) {
    diagnosis = `开始率不错（${starts}/${views}）：继续观察复盘和回滚。`;
  }

  return {
    views,
    starts,
    actionStarts,
    observeStarts,
    dismisses,
    readouts,
    rollbacks,
    cancels,
    startsPerView: views > 0 ? starts / views : 0,
    rollbackRate,
    dismissPerView: views > 0 ? dismisses / views : 0,
    diagnosis,
    byTemplate,
    note: "本地演示事件：打开抽屉记一次 view；不是生产埋点。",
  };
}

export function clearExperimentEvents() {
  writeStore({ events: [] });
}
