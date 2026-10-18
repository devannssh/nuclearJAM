import type {
  JamClientMessageInput,
  JamServerMessage,
} from '@nuclearplayer/model';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type JamSocket = {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

export type JamClientOptions = {
  createSocket?: (url: string) => JamSocket;
  now?: () => number;
};

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
const PING_INTERVAL_MS = 30000;
const INITIAL_PING_COUNT = 3;

const defaultCreateSocket = (url: string): JamSocket =>
  new WebSocket(url) as unknown as JamSocket;

const parseServerMessage = (data: unknown): JamServerMessage | null => {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as JamServerMessage;
    }
  } catch {
    return null;
  }
  return null;
};

export class JamClient {
  private readonly createSocket: (url: string) => JamSocket;
  private readonly now: () => number;
  private socket: JamSocket | null = null;
  private url = '';
  private buildHello: (() => JamClientMessageInput) | null = null;
  private wantConnected = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private bestRoundTripMs = Number.POSITIVE_INFINITY;
  private offsetMs = 0;
  private currentStatus: ConnectionStatus = 'disconnected';
  private readonly messageListeners = new Set<
    (message: JamServerMessage) => void
  >();
  private readonly statusListeners = new Set<
    (status: ConnectionStatus) => void
  >();

  constructor(options: JamClientOptions = {}) {
    this.createSocket = options.createSocket ?? defaultCreateSocket;
    this.now = options.now ?? (() => Date.now());
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  onMessage(listener: (message: JamServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(url: string, buildHello: () => JamClientMessageInput): void {
    if (this.socket && url !== this.url) {
      this.disconnect();
    }
    this.url = url;
    this.buildHello = buildHello;
    this.wantConnected = true;
    if (this.socket) {
      return;
    }
    this.open();
  }

  disconnect(): void {
    this.wantConnected = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
    this.setStatus('disconnected');
  }

  send(message: JamClientMessageInput): boolean {
    if (this.currentStatus !== 'connected' && message.type !== 'hello') {
      return false;
    }
    if (!this.socket) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open(): void {
    this.setStatus('connecting');
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.buildHello) {
        socket.send(JSON.stringify(this.buildHello()));
      }
    };
    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (message) {
        this.handle(message);
      }
    };
    socket.onclose = () => this.handleClose(socket);
    socket.onerror = () => undefined;
  }

  private handle(message: JamServerMessage): void {
    if (message.type === 'welcome') {
      this.attempt = 0;
      this.bestRoundTripMs = Number.POSITIVE_INFINITY;
      this.offsetMs = message.serverTime - this.now();
      this.setStatus('connected');
      this.startPinging();
    }
    if (message.type === 'pong') {
      this.recordPong(message.clientTime, message.serverTime);
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private recordPong(clientTime: number, serverTime: number): void {
    const receivedAt = this.now();
    const roundTripMs = receivedAt - clientTime;
    if (roundTripMs < 0 || roundTripMs > this.bestRoundTripMs) {
      return;
    }
    this.bestRoundTripMs = roundTripMs;
    this.offsetMs = serverTime + roundTripMs / 2 - receivedAt;
  }

  private startPinging(): void {
    this.clearPing();
    for (let count = 0; count < INITIAL_PING_COUNT; count += 1) {
      this.sendPing();
    }
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private sendPing(): void {
    this.send({ type: 'ping', clientTime: this.now() });
  }

  private handleClose(closedSocket: JamSocket): void {
    if (this.socket !== closedSocket) {
      return;
    }
    this.socket = null;
    this.clearPing();
    if (!this.wantConnected) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('connecting');
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.attempt, RETRY_MAX_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wantConnected && !this.socket) {
        this.open();
      }
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) {
      return;
    }
    this.currentStatus = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

export const jamClient = new JamClient();
