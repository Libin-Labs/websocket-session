export type SessionState = 'idle' | 'connecting' | 'open' | 'waiting' | 'stopped' | 'exhausted';

export interface WebSocketHandlers {
  message(data: string): void;
  close(reason?: unknown): void;
}

export interface WebSocketTransport {
  send(data: string): void;
  close(): void;
}

export interface WebSocketSessionOptions {
  connect(handlers: WebSocketHandlers): WebSocketTransport | PromiseLike<WebSocketTransport>;
  onMessage?: (data: string) => void;
  onStateChange?: (state: SessionState) => void;
  onError?: (error: unknown) => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  maxReconnects?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxFrameBytes?: number;
}

export interface WebSocketSession {
  start(): Promise<void>;
  send(data: string): void;
  stop(): void;
  snapshot(): { state: SessionState; reconnects: number };
}

export class WebSocketSessionError extends Error {
  constructor(
    readonly code: 'not-open' | 'frame-too-large' | 'stopped',
    message: string,
  ) {
    super(message);
    this.name = 'WebSocketSessionError';
  }
}

function integer(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${minimum}.`);
  }
  return value;
}

const defaultSchedule = (callback: () => void, delayMs: number) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

export function createWebSocketSession(options: WebSocketSessionOptions): WebSocketSession {
  if (!options || typeof options.connect !== 'function')
    throw new TypeError('connect must be a function.');
  const maxReconnects = integer(options.maxReconnects ?? 5, 'maxReconnects', 0);
  const baseDelayMs = integer(options.baseDelayMs ?? 250, 'baseDelayMs', 0);
  const maxDelayMs = integer(options.maxDelayMs ?? 30_000, 'maxDelayMs', 0);
  if (maxDelayMs < baseDelayMs) throw new RangeError('maxDelayMs cannot be less than baseDelayMs.');
  const maxFrameBytes = integer(options.maxFrameBytes ?? 1_048_576, 'maxFrameBytes', 1);
  const schedule = options.schedule ?? defaultSchedule;
  if (typeof schedule !== 'function') throw new TypeError('schedule must be a function.');
  for (const [name, callback] of Object.entries({
    onMessage: options.onMessage,
    onStateChange: options.onStateChange,
    onError: options.onError,
  }))
    if (callback !== undefined && typeof callback !== 'function')
      throw new TypeError(`${name} must be a function.`);

  let state: SessionState = 'idle';
  let reconnects = 0;
  let transport: WebSocketTransport | undefined;
  let cancelReconnect: (() => void) | undefined;
  let generation = 0;
  let intentionalStop = false;
  const stateChange = (next: SessionState) => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  };
  const report = (error: unknown) => options.onError?.(error);

  const scheduleNext = () => {
    if (intentionalStop) return;
    if (reconnects >= maxReconnects) {
      stateChange('exhausted');
      return;
    }
    const attempt = reconnects++;
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt, 30));
    stateChange('waiting');
    cancelReconnect = schedule(() => {
      cancelReconnect = undefined;
      void open();
    }, delay);
  };

  const open = async (): Promise<void> => {
    if (intentionalStop) return;
    stateChange('connecting');
    const currentGeneration = ++generation;
    try {
      const next = await options.connect({
        message(data) {
          if (currentGeneration !== generation || state !== 'open') return;
          if (typeof data !== 'string') {
            report(new TypeError('Transport messages must be strings.'));
            return;
          }
          if (new TextEncoder().encode(data).byteLength > maxFrameBytes) {
            report(
              new WebSocketSessionError('frame-too-large', 'Inbound frame exceeds maxFrameBytes.'),
            );
            return;
          }
          options.onMessage?.(data);
        },
        close(reason) {
          if (currentGeneration !== generation || intentionalStop) return;
          transport = undefined;
          if (reason !== undefined) report(reason);
          scheduleNext();
        },
      });
      if (!next || typeof next.send !== 'function' || typeof next.close !== 'function') {
        throw new TypeError('connect must return a transport with send() and close().');
      }
      if (currentGeneration !== generation || intentionalStop) {
        next.close();
        return;
      }
      transport = next;
      stateChange('open');
    } catch (error) {
      if (currentGeneration !== generation || intentionalStop) return;
      report(error);
      scheduleNext();
    }
  };

  return {
    async start() {
      if (state === 'stopped')
        throw new WebSocketSessionError('stopped', 'Session has been stopped.');
      if (state !== 'idle') return;
      intentionalStop = false;
      await open();
    },
    send(data) {
      if (typeof data !== 'string') throw new TypeError('WebSocket frames must be strings.');
      if (new TextEncoder().encode(data).byteLength > maxFrameBytes) {
        throw new WebSocketSessionError('frame-too-large', 'Outbound frame exceeds maxFrameBytes.');
      }
      if (state !== 'open' || !transport)
        throw new WebSocketSessionError('not-open', 'Session is not connected.');
      transport.send(data);
    },
    stop() {
      if (state === 'stopped') return;
      intentionalStop = true;
      generation++;
      cancelReconnect?.();
      cancelReconnect = undefined;
      const active = transport;
      transport = undefined;
      stateChange('stopped');
      active?.close();
    },
    snapshot() {
      return { state, reconnects };
    },
  };
}
