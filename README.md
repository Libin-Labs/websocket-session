# @lp-labs/websocket-session

A bounded session lifecycle and reconnect state machine around a caller-supplied transport. This
package does **not** implement WebSocket networking, browser APIs, or Node socket transport.

## Install

```bash
npm install @lp-labs/websocket-session
```

Independent package with ESM/CommonJS builds, TypeScript declarations, and no runtime or peer
dependencies. CommonJS consumers can use `require('@lp-labs/websocket-session')`.

## Quickstart

```js
import { createWebSocketSession } from '@lp-labs/websocket-session';

const session = createWebSocketSession({
  connect: () => ({ send() {}, close() {} }),
  onMessage: (text) => console.log('server:', text),
  maxReconnects: 5,
});
await session.start();
session.send(JSON.stringify({ kind: 'hello' }));
```

`connect` is injected and must return `{ send(text), close() }` immediately or as a promise. It
receives `{ message(text), close(reason?) }` callbacks to bridge transport events. `start()` opens
the initial connection, `send()` only works while open, `stop()` cancels retry and closes the
adapter, and `snapshot()` exposes state and retry count.
`WebSocketSessionError` reports `not-open`, `frame-too-large`, and `stopped` send failures.

## Customization and behavior

Options are `maxReconnects` (5), `baseDelayMs` (250), `maxDelayMs` (30000), `maxFrameBytes`
(1 MiB), and optional `onMessage`, `onStateChange`, `onError`, and `schedule(callback, delayMs)`.
Retry delays double from the base and clamp at the maximum. All limits are validated safe
integers. A scheduler can be injected for deterministic testing. Invalid or oversized inbound
frames are dropped and reported; oversized outbound frames throw. Exhausted retries enter the
terminal `exhausted` state. Transport errors are surfaced to `onError`.

## Limitations

There is deliberately no built-in socket creation, handshake, subprotocol negotiation, heartbeat,
binary frame support, message queue, authentication, or browser/SSR behavior. The injected adapter
owns transport security, wire-level errors, and lifecycle integration. Frames are text strings
bounded by UTF-8 byte length. Retry state is not persisted.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
