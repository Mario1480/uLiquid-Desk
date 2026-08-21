import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldReconnectWebSocketOnResume,
  webSocketReconnectDelayMs
} from "./useReconnectingWebSocket";

test("websocket reconnect delay uses bounded exponential backoff with jitter", () => {
  assert.equal(webSocketReconnectDelayMs(0, 0.5), 1_000);
  assert.equal(webSocketReconnectDelayMs(1, 0.5), 2_000);
  assert.equal(webSocketReconnectDelayMs(5, 0.5), 30_000);
  assert.equal(webSocketReconnectDelayMs(20, 1), 30_000);
});

test("websocket reconnects when its previous browser session became stale", () => {
  assert.equal(
    shouldReconnectWebSocketOnResume({
      readyState: 1,
      hiddenForMs: 60_000,
      lastActivityAgeMs: 500,
      staleAfterMs: 60_000
    }),
    true
  );
  assert.equal(
    shouldReconnectWebSocketOnResume({
      readyState: 1,
      hiddenForMs: 5_000,
      lastActivityAgeMs: 60_000,
      staleAfterMs: 60_000
    }),
    true
  );
});

test("websocket keeps a recent open connection and replaces a closed one", () => {
  assert.equal(
    shouldReconnectWebSocketOnResume({
      readyState: 1,
      hiddenForMs: 5_000,
      lastActivityAgeMs: 5_000,
      staleAfterMs: 60_000
    }),
    false
  );
  assert.equal(
    shouldReconnectWebSocketOnResume({
      readyState: 3,
      hiddenForMs: 0,
      lastActivityAgeMs: 0,
      staleAfterMs: 60_000
    }),
    true
  );
});
