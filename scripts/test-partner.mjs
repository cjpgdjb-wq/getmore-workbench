// End-to-end probe for the multi-expert orchestrator (SSE).
const goal =
  process.argv.slice(2).join(" ") ||
  "双 11 蓄水期，帮我看哪些账户值得加预算、哪些应该暂停。目标整体支付 ROI 不低于 3.5，并控制余额风险。";

const payload = {
  goal,
  view: {
    channel: "auction",
    dimensionLabel: "账户",
    range: { start: "2026-10-26", end: "2026-11-01", preset: "last7" },
    orgName: null,
    search: "",
  },
};

const started = Date.now();
const response = await fetch("http://127.0.0.1:5180/partner/run", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  console.error("HTTP", response.status, await response.text());
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let currentEvent = "message";
let events = 0;
const types = new Map();

function handle(event, data) {
  events += 1;
  types.set(event, (types.get(event) ?? 0) + 1);
  if (event === "plan") {
    console.log("\n[PLAN]", data.plan.intent);
    console.log(" experts:", data.plan.experts.map((e) => `${e.name}:${e.focus}`).join(" | "));
  } else if (event === "context_l1") {
    console.log("[CONTEXT L1]", data.layer.tokens, "tokens; memory hits:", data.memoryHits.length);
  } else if (event === "context") {
    console.log("[CONTEXT]", data.layers.map((l) => `${l.key}:${l.tokens}/${l.budget}`).join(" "));
  } else if (event === "expert_start") {
    console.log("\n[EXPERT START]", data.expert.name, "-", data.focus);
  } else if (event === "tool_call") {
    console.log("  ->", data.label, JSON.stringify(data.args).slice(0, 120));
  } else if (event === "tool_result") {
    console.log("  <-", data.ok ? "ok" : "fail", data.summary);
  } else if (event === "expert_end") {
    console.log("[EXPERT END]", data.expertId, data.latencyMs + "ms", "finding:", data.finding.slice(0, 160));
  } else if (event === "delta") {
    process.stdout.write(data.text);
  } else if (event === "action_proposal") {
    console.log("\n[PROPOSAL]", data.proposal.title, "|", data.proposal.status, "|", data.proposal.violations);
  } else if (event === "operation_applied") {
    console.log(
      "\n[OPERATION]",
      data.operation.target_name,
      data.operation.field,
      data.operation.before,
      "->",
      data.operation.after,
    );
  } else if (event === "memory_write") {
    console.log("\n[MEMORY]", data.entries.map((e) => `${e.kind}:${e.text.slice(0, 60)}`).join(" | "));
  } else if (event === "error") {
    console.log("\n[ERROR]", data.message);
  } else if (event === "run_end") {
    console.log("\n[RUN END]", data.latencyMs + "ms", JSON.stringify(data.usage));
  } else if (event === "notice") {
    console.log("\n[NOTICE]", data.message);
  }
}

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const blocks = buffer.split("\n\n");
  buffer = blocks.pop() ?? "";
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      handle(event, JSON.parse(dataLines.join("\n")));
    } catch {
      /* ignore */
    }
  }
}

console.log("\n\nDONE in", Date.now() - started, "ms; events:", events, Object.fromEntries(types));
