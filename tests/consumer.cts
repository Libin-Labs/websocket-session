import { createWebSocketSession, type SessionState } from '@lp-labs/websocket-session';
let state: SessionState = 'idle';
const session = createWebSocketSession({
  connect: () => ({ send() {}, close() {} }),
  onStateChange: (next) => {
    state = next;
  },
});
session.send('hello');
void state;
