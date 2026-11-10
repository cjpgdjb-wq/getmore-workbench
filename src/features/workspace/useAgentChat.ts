import { useCallback, useEffect, useRef, useState } from "react";
import { NanobotGateway, type GatewayEvent, type GatewayStatus } from "../../lib/nanobot";
import { extractAgentAction } from "../../lib/agentAction";
import type { AgentAction } from "../../state/workbench";

export interface ToolStep {
  id: string;
  name: string;
  hint: string;
  args?: string;
  result?: string;
  error?: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 实际发送给 Agent 的完整内容（含上下文），仅用于重试 */
  content?: string;
  context?: boolean;
  reasoning?: string;
  steps?: ToolStep[];
  streaming?: boolean;
  error?: string;
  createdAt: number;
  latencyMs?: number;
  usage?: { input?: number; output?: number };
  action?: AgentAction | null;
}

export interface ChatSession {
  id: string;
  chatId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** 智能助手会话：绑定到固定商品 */
  threadId?: string;
  productId?: string;
  /** 从上一段会话带过来的摘要 */
  summary?: string;
}

export interface SessionMeta {
  title?: string;
  threadId?: string;
  productId?: string;
  summary?: string;
  forceNew?: boolean;
}

interface PersistedState {
  activeId: string | null;
  sessions: ChatSession[];
}

const STORAGE_KEY = "getmore.chat.v1";
const MAX_SESSIONS = 40;
const MAX_MESSAGES = 80;

let sequence = 0;
function uid(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeSession(meta: SessionMeta = {}): ChatSession {
  const now = Date.now();
  return {
    id: uid("s"),
    chatId: null,
    title: meta.title ?? "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
    threadId: meta.threadId,
    productId: meta.productId,
    summary: meta.summary,
  };
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || !Array.isArray(parsed.sessions)) return null;
    const sessions = parsed.sessions.slice(0, MAX_SESSIONS).map((session) => ({
      ...session,
      messages: (session.messages ?? [])
        .filter((message) => !(message.streaming && !message.text && !message.steps?.length && !message.error))
        .slice(-MAX_MESSAGES)
        .map((message) => ({ ...message, streaming: false })),
    }));
    return { activeId: parsed.activeId ?? sessions[0]?.id ?? null, sessions };
  } catch {
    return null;
  }
}

function safeStringify(value: unknown, limit = 1600): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return "";
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return "";
  }
}

export interface SendOptions {
  context?: string;
  includeContext?: boolean;
}

export interface AgentChat {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  activeId: string | null;
  status: GatewayStatus;
  model: string;
  busy: boolean;
  connectionError: string | null;
  send: (text: string, options?: SendOptions) => Promise<void>;
  askNew: (text: string, options?: SendOptions) => Promise<void>;
  newSession: (meta?: SessionMeta) => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  retry: (sessionId: string, messageId: string) => Promise<void>;
  stop: () => void;
  reconnect: () => Promise<void>;
}

export function useAgentChat(): AgentChat {
  const initial = useRef<PersistedState | null>(loadPersisted());
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const stored = initial.current;
    if (stored && stored.sessions.length) return stored.sessions;
    return [makeSession()];
  });
  const [activeId, setActiveId] = useState<string | null>(() => {
    const stored = initial.current;
    if (stored && stored.activeId) return stored.activeId;
    return null;
  });
  const [status, setStatus] = useState<GatewayStatus>("connecting");
  const [model, setModel] = useState("deepseek-flash");
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const sessionsRef = useRef(sessions);
  const activeIdRef = useRef(activeId);
  const gatewayRef = useRef<NanobotGateway | null>(null);
  const connectPromiseRef = useRef<Promise<NanobotGateway> | null>(null);
  const busyRef = useRef(false);
  const turnRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  const attachedRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const session = sessions.find((item) => item.id === activeId) ?? sessions[0] ?? null;
    if (session && session.id !== activeId) {
      setActiveId(session.id);
    }
  }, [sessions, activeId]);

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const payload: PersistedState = {
          activeId,
          sessions: sessions.slice(0, MAX_SESSIONS).map((session) => ({
            ...session,
            messages: session.messages.slice(-MAX_MESSAGES),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        /* storage quota */
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [sessions, activeId]);

  /* ---------------- message patching ---------------- */

  const patchTurnMessage = useCallback((updater: (message: ChatMessage) => ChatMessage) => {
    const turn = turnRef.current;
    if (!turn) return;
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== turn.sessionId) return session;
        return {
          ...session,
          updatedAt: Date.now(),
          messages: session.messages.map((message) => (message.id === turn.messageId ? updater(message) : message)),
        };
      }),
    );
  }, []);

  const failActiveTurn = useCallback(
    (detail: string) => {
      patchTurnMessage((message) => ({
        ...message,
        streaming: false,
        error: detail,
        steps: message.steps?.map((step) => (step.status === "running" ? { ...step, status: "error" } : step)),
      }));
      turnRef.current = null;
      busyRef.current = false;
      setBusy(false);
    },
    [patchTurnMessage],
  );

  /* ---------------- gateway event handling ---------------- */

  const handleEvent = useCallback(
    (event: GatewayEvent) => {
      const { type, data } = event;
      switch (type) {
        case "message_accepted": {
          busyRef.current = true;
          setBusy(true);
          break;
        }
        case "delta": {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) break;
          patchTurnMessage((message) => ({ ...message, text: `${message.text}${text}`, streaming: true }));
          break;
        }
        case "reasoning_delta": {
          const text = typeof data.text === "string" ? data.text : "";
          if (!text) break;
          patchTurnMessage((message) => ({ ...message, reasoning: `${message.reasoning ?? ""}${text}` }));
          break;
        }
        case "message": {
          const toolEvents = Array.isArray(data.tool_events) ? (data.tool_events as Record<string, unknown>[]) : [];
          if (toolEvents.length) {
            patchTurnMessage((message) => {
              const steps = [...(message.steps ?? [])];
              for (const raw of toolEvents) {
                const callId = String(raw.call_id ?? raw.id ?? "");
                const name = String(raw.name ?? "tool");
                const phase = String(raw.phase ?? "");
                if (phase === "start") {
                  const existing = steps.find((step) => step.id === callId && callId !== "");
                  if (existing) {
                    existing.hint = typeof data.text === "string" && data.text.trim() ? data.text.trim() : existing.hint;
                    existing.args = safeStringify(raw.arguments) || existing.args;
                    existing.status = "running";
                    continue;
                  }
                  steps.push({
                    id: callId || `${name}-${steps.length}`,
                    name,
                    hint: typeof data.text === "string" && data.text.trim() ? data.text.trim() : name,
                    args: safeStringify(raw.arguments),
                    status: "running",
                  });
                  continue;
                }
                const index = [...steps].reverse().findIndex((step) => step.id === callId);
                const targetIndex = index >= 0 ? steps.length - 1 - index : steps.length - 1;
                if (targetIndex < 0) continue;
                steps[targetIndex] = {
                  ...steps[targetIndex],
                  status: phase === "error" ? "error" : "done",
                  result: raw.result ? safeStringify(raw.result) : steps[targetIndex].result,
                  error: typeof raw.error === "string" ? raw.error : undefined,
                };
              }
              return { ...message, steps };
            });
            break;
          }
          if (typeof data.text === "string" && data.text.trim() && !data.kind) {
            const finalText = data.text;
            patchTurnMessage((message) =>
              message.text.trim().length >= finalText.trim().length ? message : { ...message, text: finalText },
            );
          }
          break;
        }
        case "file_edit": {
          const edits = Array.isArray(data.edits) ? (data.edits as Record<string, unknown>[]) : [];
          if (!edits.length) break;
          patchTurnMessage((message) => {
            const steps = [...(message.steps ?? [])];
            for (const edit of edits) {
              const callId = `file-${String(edit.call_id ?? "")}`;
              const path = String(edit.path ?? edit.absolute_path ?? "");
              const phase = String(edit.phase ?? "");
              const existing = steps.findIndex((step) => step.id === callId);
              const status = phase === "error" ? "error" : phase === "end" ? "done" : "running";
              if (existing >= 0) {
                steps[existing] = { ...steps[existing], status, error: typeof edit.error === "string" ? edit.error : undefined };
              } else {
                steps.push({
                  id: callId,
                  name: `写入文件`,
                  hint: path,
                  args: edit.operation ? String(edit.operation) : undefined,
                  status,
                });
              }
            }
            return { ...message, steps };
          });
          break;
        }
        case "turn_end": {
          const usage = (data.usage ?? {}) as Record<string, unknown>;
          const latency = Number(data.latency_ms ?? 0);
          patchTurnMessage((message) => {
            const parsed = extractAgentAction(message.text);
            return {
              ...message,
              streaming: false,
              text: parsed.action ? parsed.text : message.text,
              action: parsed.action,
              latencyMs: Number.isFinite(latency) && latency > 0 ? latency : undefined,
              usage: {
                input: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || undefined,
                output: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || undefined,
              },
            };
          });
          turnRef.current = null;
          busyRef.current = false;
          setBusy(false);
          break;
        }
        case "error": {
          const detail =
            typeof data.detail === "string"
              ? data.detail
              : typeof data.reason === "string"
                ? data.reason
                : "Agent 返回了错误";
          failActiveTurn(detail);
          break;
        }
        case "stream_end": {
          if (typeof data.text === "string" && data.text.trim()) {
            const finalText = data.text;
            patchTurnMessage((message) =>
              message.text.trim().length >= finalText.trim().length ? message : { ...message, text: finalText },
            );
          }
          break;
        }
        default:
          break;
      }
    },
    [patchTurnMessage, failActiveTurn],
  );

  const handleEventRef = useRef(handleEvent);
  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  /* ---------------- connection ---------------- */

  const openGateway = useCallback(async (): Promise<NanobotGateway> => {
    if (gatewayRef.current?.isOpen()) return gatewayRef.current;
    if (connectPromiseRef.current) return connectPromiseRef.current;

    const gateway = gatewayRef.current ?? new NanobotGateway();
    gateway.onEvent = (event) => handleEventRef.current(event);
    gateway.onClose = () => {
      if (!mountedRef.current) return;
      setStatus("offline");
      if (busyRef.current) failActiveTurn("连接已断开，请重试");
      if (reconnectAttemptsRef.current < 3) {
        reconnectAttemptsRef.current += 1;
        if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => {
          openGatewayRef.current().catch(() => undefined);
        }, 2200);
      }
    };
    gatewayRef.current = gateway;
    attachedRef.current.clear();
    setStatus("connecting");

    const promise = (async () => {
      await gateway.connect();
      if (!mountedRef.current) return gateway;
      reconnectAttemptsRef.current = 0;
      setModel(gateway.getModel());
      setStatus("online");
      setConnectionError(null);
      return gateway;
    })();

    connectPromiseRef.current = promise;
    try {
      return await promise;
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法连接 Nanobot 网关";
      if (mountedRef.current) {
        setStatus("offline");
        setConnectionError(message);
      }
      throw error;
    } finally {
      connectPromiseRef.current = null;
    }
  }, [failActiveTurn]);

  const openGatewayRef = useRef(openGateway);
  useEffect(() => {
    openGatewayRef.current = openGateway;
  }, [openGateway]);

  useEffect(() => {
    mountedRef.current = true;
    openGateway().catch(() => undefined);
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      gatewayRef.current?.close();
      gatewayRef.current = null;
    };
  }, [openGateway]);

  const reconnect = useCallback(async () => {
    reconnectAttemptsRef.current = 0;
    gatewayRef.current?.close();
    gatewayRef.current = null;
    setStatus("connecting");
    try {
      await openGateway();
    } catch {
      /* status handled */
    }
  }, [openGateway]);

  /* ---------------- sending ---------------- */

  const dispatchTurn = useCallback(
    async (session: ChatSession, userMessage: ChatMessage, content: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);

      const assistantMessage: ChatMessage = {
        id: uid("m"),
        role: "assistant",
        text: "",
        streaming: true,
        steps: [],
        createdAt: Date.now(),
      };

      const merged: ChatSession = {
        ...session,
        title:
          session.title === "新对话" && !session.messages.some((message) => message.role === "user")
            ? userMessage.text.slice(0, 24)
            : session.title,
        updatedAt: Date.now(),
        messages: [...session.messages, userMessage, assistantMessage],
      };

      setSessions((prev) => {
        if (prev.some((item) => item.id === session.id)) {
          return prev.map((item) => (item.id === session.id ? merged : item));
        }
        return [merged, ...prev];
      });
      setActiveId(session.id);
      activeIdRef.current = session.id;
      turnRef.current = { sessionId: session.id, messageId: assistantMessage.id };

      try {
        const gateway = await openGateway();
        let chatId = session.chatId;
        if (!chatId) {
          chatId = await gateway.newChat();
          attachedRef.current.add(chatId);
          setSessions((prev) => prev.map((item) => (item.id === session.id ? { ...item, chatId } : item)));
        } else if (!attachedRef.current.has(chatId)) {
          gateway.attach(chatId);
          attachedRef.current.add(chatId);
        }
        const sent = gateway.sendMessage(chatId, content, uid("turn").replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64));
        if (!sent) throw new Error("消息发送失败，连接可能已断开");
      } catch (error) {
        const message = error instanceof Error ? error.message : "发送失败";
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  messages: item.messages.map((entry) =>
                    entry.id === assistantMessage.id ? { ...entry, streaming: false, error: message } : entry,
                  ),
                }
              : item,
          ),
        );
        turnRef.current = null;
        busyRef.current = false;
        setBusy(false);
        setConnectionError(message);
      }
    },
    [openGateway],
  );

  const send = useCallback(
    async (text: string, options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      const session = sessionsRef.current.find((item) => item.id === activeIdRef.current) ?? makeSession();
      const useContext = Boolean(options.includeContext && options.context);
      const content = useContext ? `${options.context}\n\n[用户问题]\n${trimmed}` : trimmed;
      const userMessage: ChatMessage = {
        id: uid("m"),
        role: "user",
        text: trimmed,
        content,
        context: useContext,
        createdAt: Date.now(),
      };
      await dispatchTurn(session, userMessage, content);
    },
    [dispatchTurn],
  );

  const askNew = useCallback(
    async (text: string, options: SendOptions = {}) => {
      const session = makeSession();
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
      activeIdRef.current = session.id;
      const trimmed = text.trim();
      if (!trimmed) return;
      const useContext = Boolean(options.includeContext && options.context);
      const content = useContext ? `${options.context}\n\n[用户问题]\n${trimmed}` : trimmed;
      const userMessage: ChatMessage = {
        id: uid("m"),
        role: "user",
        text: trimmed,
        content,
        context: useContext,
        createdAt: Date.now(),
      };
      await dispatchTurn(session, userMessage, content);
    },
    [dispatchTurn],
  );

  const retry = useCallback(
    async (sessionId: string, messageId: string) => {
      if (busyRef.current) return;
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (!session) return;
      const index = session.messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      let userIndex = -1;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (session.messages[cursor].role === "user") {
          userIndex = cursor;
          break;
        }
      }
      if (userIndex < 0) return;
      const userMessage = session.messages[userIndex];
      const trimmed = userMessage.text;
      const content = userMessage.content ?? trimmed;
      const nextUser: ChatMessage = { ...userMessage, id: uid("m"), createdAt: Date.now() };
      const trimmedSession: ChatSession = {
        ...session,
        title: session.title === "新对话" ? trimmed.slice(0, 24) : session.title,
        messages: session.messages.slice(0, userIndex),
      };
      await dispatchTurn(trimmedSession, nextUser, content);
    },
    [dispatchTurn],
  );

  const stop = useCallback(() => {
    const gateway = gatewayRef.current;
    const turn = turnRef.current;
    const session = turn ? sessionsRef.current.find((item) => item.id === turn.sessionId) : null;
    const chatId = session?.chatId;
    if (gateway?.isOpen() && chatId) {
      gateway.stop(chatId);
      patchTurnMessage((message) => ({ ...message, streaming: true }));
    }
  }, [patchTurnMessage]);

  const newSession = useCallback((meta: SessionMeta = {}) => {
    if (meta.threadId && !meta.forceNew) {
      const existing = sessionsRef.current.find((session) => session.threadId === meta.threadId);
      if (existing) {
        setActiveId(existing.id);
        activeIdRef.current = existing.id;
        return;
      }
    }
    const workspaceSessions = sessionsRef.current.filter((session) => session.threadId === meta.threadId);
    const session = makeSession({
      ...meta,
      title: meta.title
        ? workspaceSessions.length > 0
          ? `${meta.title} · 对话 ${workspaceSessions.length + 1}`
          : meta.title
        : meta.title,
    });
    setSessions((prev) => [session, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(session.id);
    activeIdRef.current = session.id;
  }, []);

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    const remaining = sessionsRef.current.filter((item) => item.id !== id);
    if (remaining.length === 0) {
      const session = makeSession();
      setSessions([session]);
      setActiveId(session.id);
      activeIdRef.current = session.id;
      return;
    }
    setSessions(remaining);
    if (activeIdRef.current === id) {
      setActiveId(remaining[0].id);
      activeIdRef.current = remaining[0].id;
    }
  }, []);

  const activeSession = sessions.find((item) => item.id === activeId) ?? sessions[0] ?? null;

  return {
    sessions,
    activeSession,
    activeId,
    status,
    model,
    busy,
    connectionError,
    send,
    askNew,
    newSession,
    selectSession,
    deleteSession,
    retry,
    stop,
    reconnect,
  };
}
