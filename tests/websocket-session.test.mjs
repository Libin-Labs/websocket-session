import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebSocketSession, WebSocketSessionError } from '../dist/esm/index.js';

test('opens an injected transport, delivers messages, and sends frames', async () => {
  let handlers;
  const sent = [];
  const received = [];
  const session = createWebSocketSession({
    connect: (value) => {
      handlers = value;
      return { send: (frame) => sent.push(frame), close() {} };
    },
    onMessage: (frame) => received.push(frame),
  });
  await session.start();
  session.send('hello');
  handlers.message('reply');
  assert.deepEqual(sent, ['hello']);
  assert.deepEqual(received, ['reply']);
  assert.equal(session.snapshot().state, 'open');
});

test('uses injected scheduling and bounded exponential reconnect attempts', async () => {
  const scheduled = [];
  const delays = [];
  let handlers;
  let connections = 0;
  const session = createWebSocketSession({
    maxReconnects: 1,
    baseDelayMs: 10,
    maxDelayMs: 100,
    schedule(callback, delay) {
      scheduled.push(callback);
      delays.push(delay);
      return () => {};
    },
    connect(value) {
      connections++;
      handlers = value;
      return { send() {}, close() {} };
    },
  });
  await session.start();
  handlers.close();
  assert.deepEqual(delays, [10]);
  scheduled.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connections, 2);
  handlers.close();
  assert.equal(session.snapshot().state, 'exhausted');
});

test('schedules reconnect after a failed injected connection', async () => {
  let scheduled;
  let calls = 0;
  const session = createWebSocketSession({
    maxReconnects: 1,
    schedule(callback) {
      scheduled = callback;
      return () => {};
    },
    connect() {
      calls++;
      if (calls === 1) throw new Error('offline');
      return { send() {}, close() {} };
    },
  });
  await session.start();
  assert.equal(session.snapshot().state, 'waiting');
  scheduled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot().state, 'open');
});

test('rejects sending while disconnected and after stopping', async () => {
  const session = createWebSocketSession({ connect: () => ({ send() {}, close() {} }) });
  assert.throws(() => session.send('x'), WebSocketSessionError);
  await session.start();
  session.stop();
  assert.throws(() => session.send('x'), WebSocketSessionError);
  await assert.rejects(session.start(), WebSocketSessionError);
});

test('drops oversized inbound frames and rejects oversized outbound frames', async () => {
  let handlers;
  const errors = [];
  const session = createWebSocketSession({
    maxFrameBytes: 2,
    connect: (value) => {
      handlers = value;
      return { send() {}, close() {} };
    },
    onError: (error) => errors.push(error),
  });
  await session.start();
  assert.throws(() => session.send('💡'), WebSocketSessionError);
  handlers.message('abc');
  assert.equal(errors[0].code, 'frame-too-large');
});

test('ignores callbacks from superseded transports after stop', async () => {
  let handlers;
  let messages = 0;
  const session = createWebSocketSession({
    connect: (value) => {
      handlers = value;
      return { send() {}, close() {} };
    },
    onMessage: () => messages++,
  });
  await session.start();
  session.stop();
  handlers.message('late');
  assert.equal(messages, 0);
});

test('validates reconnect limits, delays, and connect function', () => {
  assert.throws(
    () =>
      createWebSocketSession({
        connect() {
          return { send() {}, close() {} };
        },
        maxReconnects: -1,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      createWebSocketSession({
        connect() {
          return { send() {}, close() {} };
        },
        maxDelayMs: 1,
        baseDelayMs: 2,
      }),
    RangeError,
  );
  assert.throws(() => createWebSocketSession(/** @type {any} */ ({})), TypeError);
});
