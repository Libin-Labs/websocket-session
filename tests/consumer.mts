import { createWebSocketSession, type WebSocketTransport } from '@lp-labs/websocket-session';
let transport: WebSocketTransport | undefined;
const session = createWebSocketSession({
  connect: () => (transport = { send: () => {}, close: () => {} }),
  onMessage: (frame) => console.log(frame),
});
void session.start();
void transport;
