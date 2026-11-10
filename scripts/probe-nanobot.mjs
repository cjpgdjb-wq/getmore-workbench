// Probe the local nanobot gateway WebSocket protocol end-to-end.
const base = "http://127.0.0.1:8765";

const boot = await (await fetch(`${base}/webui/bootstrap`)).json();
console.log("bootstrap:", {
  hasToken: Boolean(boot.token),
  ws_url: boot.ws_url,
  ws_path: boot.ws_path,
  model: boot.model_name,
});

const ws = new WebSocket(`${boot.ws_url}?token=${encodeURIComponent(boot.token)}`);
let chatId = null;
let done = false;

const timeout = setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(2);
}, 120000);

ws.addEventListener("open", () => console.log("ws open"));
ws.addEventListener("close", (event) => console.log("ws close", event.code, event.reason));
ws.addEventListener("error", (event) => console.log("ws error", event.message ?? event));

ws.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  const type = data.event ?? data.type ?? "?";
  if (type === "delta") {
    process.stdout.write(data.text ?? "");
    return;
  }
  if (type === "message") {
    console.log("\n[message]", JSON.stringify({ kind: data.kind, text: data.text, tool_events: data.tool_events?.map((e) => ({ phase: e.phase, name: e.name, call_id: e.call_id })) }));
    return;
  }
  console.log("\n[event]", type, JSON.stringify({ chat_id: data.chat_id, model: data.model_name, detail: data.detail, reason: data.reason, usage: data.usage, latency_ms: data.latency_ms }).slice(0, 400));

  if (type === "ready") {
    ws.send(JSON.stringify({ type: "new_chat" }));
  }
  if (type === "attached") {
    chatId = data.chat_id;
    console.log("attached chat:", chatId);
    ws.send(
      JSON.stringify({
        type: "message",
        chat_id: chatId,
        turn_id: "probe-1",
        webui: true,
        content:
          "[GETmore 工作台上下文 | 模拟数据]\n渠道: 竞价投放\n维度: 账户\n统计周期: 近 7 天\n整体消耗: 128,430.20 元\n整体支付ROI: 3.42\n整体成交订单数: 1,842\n\n请用一句话说明你能在这个工作台里帮我做什么。",
      }),
    );
  }
  if (type === "turn_end") {
    done = true;
    clearTimeout(timeout);
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 300);
  }
  if (type === "error") {
    console.log("ERROR FRAME", JSON.stringify(data));
  }
});

process.on("exit", () => {
  if (!done) console.log("exited before turn_end");
});
