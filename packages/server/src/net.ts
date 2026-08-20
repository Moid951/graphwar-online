import { Constants } from "@graphwar/math";

/**
 * Transport abstraction over a peer (WebSocket in production, in-memory in tests).
 * Mirrors GraphServer.Connection: tracks lastSent/lastReceived so the keepalive
 * and drop logic can be replicated on a single event loop.
 */
export interface SocketLike {
  send(message: string): void;
  close(): void;
  isOpen(): boolean;
}

export class ConnectedSocket implements SocketLike {
  lastReceived: number;
  lastSent: number;

  constructor(
    private readonly onMessage: (msg: string) => void,
    private readonly onClose: () => void
  ) {
    const now = Date.now();
    this.lastReceived = now;
    this.lastSent = now;
  }

  protected handleIncoming(msg: string): void {
    this.lastReceived = Date.now();
    this.onMessage(msg);
  }

  /** Called by the transport when a message arrives. Updates timestamps. */
  receive(msg: string): void {
    this.handleIncoming(msg);
  }

  protected handleClosed(): void {
    this.onClose();
  }

  /** Called by the transport when the peer disconnects. */
  handlePeerClosed(): void {
    this.handleClosed();
  }

  send(message: string): void {
    if (!this.isOpen()) return;
    this.lastSent = Date.now();
    this.sendRaw(message);
  }

  protected sendRaw(_message: string): void {
    throw new Error("not implemented");
  }

  close(): void {
    throw new Error("not implemented");
  }

  isOpen(): boolean {
    throw new Error("not implemented");
  }

  getLastReceived(): number {
    return this.lastReceived;
  }

  getLastSent(): number {
    return this.lastSent;
  }
}

/** Ticker helper: one interval drives keepalive/drop for a list of sockets. */
export class Ticker {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number, fn: () => void): void {
    this.stop();
    this.timer = setInterval(fn, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function checkDrop(lastReceived: number): boolean {
  return Date.now() - lastReceived > Constants.TIMEOUT_DROP;
}

export function checkKeepAlive(lastSent: number): boolean {
  return Date.now() - lastSent > Constants.TIMEOUT_KEEPALIVE;
}