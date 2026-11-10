/**
 * Nanobot Gateway WebSocket 客户端
 *
 * 协议参考：GET /webui/bootstrap 获取一次性 token 与 ws_url，
 * 连接后发送 new_chat / attach / message 信封，接收 delta、tool_events、
 * reasoning_delta、turn_end 等事件。
 */
export interface NanobotBootstrap {
  token: string;
  api_token?: string;
  expires_in?: number;
  ws_path?: string;
  ws_url: string;
  model_name?: string;
}

export type GatewayStatus = "connecting" | "online" | "offline";

export interface GatewayEvent {
  type: string;
  data: Record<string, unknown>;
}

const BOOTSTRAP_TIMEOUT = 8000;
const SOCKET_TIMEOUT = 12000;

export class NanobotGateway {
  private socket: WebSocket | null = null;
  private bootstrap: NanobotBootstrap | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private chatResolve: ((chatId: string) => void) | null = null;
  private chatTimer: number | null = null;
  private open = false;

  onEvent: (event: GatewayEvent) => void = () => {};
  onClose: (info: { code: number; reason: string }) => void = () => {};

  constructor(private readonly baseUrl = "") {}

  isOpen(): boolean {
    return this.open && this.socket?.readyState === WebSocket.OPEN;
  }

  getModel(): string {
    return this.bootstrap?.model_name ?? "deepseek-flash";
  }

  private async fetchBootstrap(): Promise<NanobotBootstrap> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT);
    try {
      const response = await fetch(`${this.baseUrl}/webui/bootstrap`, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`网关返回 HTTP ${response.status}`);
      }
      return (await response.json()) as NanobotBootstrap;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private resolveWsUrl(bootstrap: NanobotBootstrap): string {
    let url = bootstrap.ws_url;
    if (!url) {
      url = `ws://${window.location.host}/`;
    }
    if (window.location.protocol === "https:" && url.startsWith("ws://")) {
      url = `wss://${url.slice(6)}`;
    }
    return url;
  }

  async connect(): Promise<NanobotBootstrap> {
    this.disposeSocket();
    const bootstrap = await this.fetchBootstrap();
    this.bootstrap = bootstrap;
    const wsUrl = this.resolveWsUrl(bootstrap);
    const separator = wsUrl.includes("?") ? "&" : "?";
    const target = `${wsUrl}${separator}token=${encodeURIComponent(bootstrap.token)}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.readyReject = null;
        this.readyResolve = null;
        try {
          this.socket?.close();
        } catch {
          /* ignore */
        }
        reject(new Error("WebSocket 连接超时"));
      }, SOCKET_TIMEOUT);

      let socket: WebSocket;
      try {
        socket = new WebSocket(target);
      } catch (error) {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("无法创建 WebSocket 连接"));
        return;
      }

      this.socket = socket;
      this.readyResolve = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.open = true;
        this.readyResolve = null;
        this.readyReject = null;
        resolve();
      };
      this.readyReject = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      };

      socket.addEventListener("message", (event) => this.handleMessage(event));
      socket.addEventListener("error", () => {
        if (!settled) this.readyReject?.(new Error("WebSocket 握手失败"));
      });
      socket.addEventListener("close", (event) => {
        this.open = false;
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          this.readyReject?.(new Error(`连接被关闭（code ${event.code}）`));
        }
        this.onClose({ code: event.code, reason: event.reason });
      });
    });

    return bootstrap;
  }

  private handleMessage(event: MessageEvent): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof payload.event === "string" ? payload.event : typeof payload.type === "string" ? payload.type : "";
    if (!type) return;

    if (type === "ready") {
      this.readyResolve?.();
    }
    if (type === "attached" && typeof payload.chat_id === "string") {
      this.chatResolve?.(payload.chat_id);
      this.chatResolve = null;
      if (this.chatTimer !== null) {
        window.clearTimeout(this.chatTimer);
        this.chatTimer = null;
      }
    }

    this.onEvent({ type, data: payload });
  }

  async newChat(): Promise<string> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket 尚未连接");
    }
    return new Promise<string>((resolve, reject) => {
      this.chatResolve = resolve;
      this.chatTimer = window.setTimeout(() => {
        this.chatResolve = null;
        this.chatTimer = null;
        reject(new Error("创建会话超时"));
      }, 12000);
      this.socket?.send(JSON.stringify({ type: "new_chat" }));
    });
  }

  attach(chatId: string): void {
    this.sendFrame({ type: "attach", chat_id: chatId });
  }

  sendMessage(chatId: string, content: string, turnId: string): boolean {
    return this.sendFrame({ type: "message", chat_id: chatId, content, turn_id: turnId, webui: true });
  }

  stop(chatId: string): void {
    this.sendFrame({ type: "message", chat_id: chatId, content: "/stop", webui: true });
  }

  private sendFrame(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  private disposeSocket(): void {
    this.open = false;
    if (this.socket) {
      try {
        this.socket.close(1000, "client reconnect");
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }

  close(): void {
    this.disposeSocket();
  }
}
