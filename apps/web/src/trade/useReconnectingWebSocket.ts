"use client";

import { useCallback, useEffect, useRef } from "react";

const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
const DEFAULT_STALE_AFTER_MS = 60_000;
const STABLE_CONNECTION_MS = 10_000;
const WS_CONNECTING = 0;
const WS_OPEN = 1;

type WebSocketEventHandlers = {
  onMessage: (event: MessageEvent<string>) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
};

type UseReconnectingWebSocketOptions = WebSocketEventHandlers & {
  url: string | null;
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
};

type ResumeReconnectInput = {
  readyState: number | null;
  hiddenForMs: number;
  lastActivityAgeMs: number;
  staleAfterMs: number;
};

type BrowserLifecycleSubscriber = {
  handleOnline: () => void;
  handlePageShow: () => void;
  handleVisibilityChange: () => void;
};

const browserLifecycleSubscribers = new Set<BrowserLifecycleSubscriber>();

function notifyVisibilityChange(): void {
  for (const subscriber of browserLifecycleSubscribers) {
    subscriber.handleVisibilityChange();
  }
}

function notifyPageShow(): void {
  for (const subscriber of browserLifecycleSubscribers) {
    subscriber.handlePageShow();
  }
}

function notifyOnline(): void {
  for (const subscriber of browserLifecycleSubscribers) {
    subscriber.handleOnline();
  }
}

function subscribeToBrowserLifecycle(subscriber: BrowserLifecycleSubscriber): () => void {
  if (browserLifecycleSubscribers.size === 0) {
    document.addEventListener("visibilitychange", notifyVisibilityChange);
    window.addEventListener("pageshow", notifyPageShow);
    window.addEventListener("online", notifyOnline);
  }
  browserLifecycleSubscribers.add(subscriber);

  return () => {
    browserLifecycleSubscribers.delete(subscriber);
    if (browserLifecycleSubscribers.size === 0) {
      document.removeEventListener("visibilitychange", notifyVisibilityChange);
      window.removeEventListener("pageshow", notifyPageShow);
      window.removeEventListener("online", notifyOnline);
    }
  };
}

export function webSocketReconnectDelayMs(
  attempt: number,
  randomValue = Math.random()
): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  const exponentialDelay = Math.min(
    DEFAULT_RECONNECT_MAX_DELAY_MS,
    DEFAULT_RECONNECT_BASE_DELAY_MS * 2 ** normalizedAttempt
  );
  const normalizedRandom = Math.max(0, Math.min(1, randomValue));
  const jitterMultiplier = 0.8 + normalizedRandom * 0.4;
  return Math.min(
    DEFAULT_RECONNECT_MAX_DELAY_MS,
    Math.round(exponentialDelay * jitterMultiplier)
  );
}

export function shouldReconnectWebSocketOnResume({
  readyState,
  hiddenForMs,
  lastActivityAgeMs,
  staleAfterMs
}: ResumeReconnectInput): boolean {
  if (readyState !== WS_CONNECTING && readyState !== WS_OPEN) {
    return true;
  }
  return hiddenForMs >= staleAfterMs || lastActivityAgeMs >= staleAfterMs;
}

export function useReconnectingWebSocket({
  url,
  onMessage,
  onConnected,
  onDisconnected,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
}: UseReconnectingWebSocketOptions): () => void {
  const handlersRef = useRef<WebSocketEventHandlers>({
    onMessage,
    onConnected,
    onDisconnected
  });
  const reconnectRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    handlersRef.current = {
      onMessage,
      onConnected,
      onDisconnected
    };
  }, [onConnected, onDisconnected, onMessage]);

  useEffect(() => {
    if (!url) {
      reconnectRef.current = () => undefined;
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let stableConnectionTimer: number | null = null;
    let hiddenAt = document.hidden ? Date.now() : null;
    let lastActivityAt = Date.now();

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const clearStableConnectionTimer = () => {
      if (stableConnectionTimer !== null) {
        window.clearTimeout(stableConnectionTimer);
        stableConnectionTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delayMs = webSocketReconnectDelayMs(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (disposed) return;
      if (socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) {
        return;
      }
      if (!navigator.onLine) {
        scheduleReconnect();
        return;
      }

      clearReconnectTimer();
      let nextSocket: WebSocket;
      try {
        nextSocket = new WebSocket(url);
      } catch {
        handlersRef.current.onDisconnected?.();
        scheduleReconnect();
        return;
      }

      socket = nextSocket;
      lastActivityAt = Date.now();

      nextSocket.onopen = () => {
        if (disposed || socket !== nextSocket) return;
        lastActivityAt = Date.now();
        clearStableConnectionTimer();
        stableConnectionTimer = window.setTimeout(() => {
          if (!disposed && socket === nextSocket && nextSocket.readyState === WebSocket.OPEN) {
            reconnectAttempt = 0;
          }
        }, STABLE_CONNECTION_MS);
        handlersRef.current.onConnected?.();
      };

      nextSocket.onmessage = (event) => {
        if (disposed || socket !== nextSocket) return;
        lastActivityAt = Date.now();
        handlersRef.current.onMessage(event as MessageEvent<string>);
      };

      nextSocket.onerror = () => {
        if (disposed || socket !== nextSocket) return;
        try {
          nextSocket.close();
        } catch {
          socket = null;
          handlersRef.current.onDisconnected?.();
          scheduleReconnect();
        }
      };

      nextSocket.onclose = () => {
        if (disposed || socket !== nextSocket) return;
        socket = null;
        clearStableConnectionTimer();
        handlersRef.current.onDisconnected?.();
        scheduleReconnect();
      };
    };

    const reconnectNow = () => {
      if (disposed) return;
      clearReconnectTimer();
      clearStableConnectionTimer();
      const previousSocket = socket;
      socket = null;
      if (
        previousSocket?.readyState === WebSocket.CONNECTING ||
        previousSocket?.readyState === WebSocket.OPEN
      ) {
        previousSocket.close();
      }
      connect();
    };

    const sendHeartbeat = () => {
      if (document.hidden) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reconnectNow();
        return;
      }
      if (Date.now() - lastActivityAt >= staleAfterMs) {
        reconnectNow();
        return;
      }
      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        reconnectNow();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt ??= Date.now();
        return;
      }

      const now = Date.now();
      const hiddenForMs = hiddenAt === null ? 0 : now - hiddenAt;
      hiddenAt = null;
      if (
        shouldReconnectWebSocketOnResume({
          readyState: socket?.readyState ?? null,
          hiddenForMs,
          lastActivityAgeMs: now - lastActivityAt,
          staleAfterMs
        })
      ) {
        reconnectNow();
        return;
      }
      sendHeartbeat();
    };

    const handlePageShow = () => {
      if (!document.hidden) handleVisibilityChange();
    };

    const handleOnline = () => {
      reconnectNow();
    };

    reconnectRef.current = reconnectNow;
    const unsubscribeFromBrowserLifecycle = subscribeToBrowserLifecycle({
      handleVisibilityChange,
      handlePageShow,
      handleOnline
    });
    const heartbeatTimer = window.setInterval(sendHeartbeat, heartbeatIntervalMs);
    connect();

    return () => {
      disposed = true;
      reconnectRef.current = () => undefined;
      unsubscribeFromBrowserLifecycle();
      window.clearInterval(heartbeatTimer);
      clearReconnectTimer();
      clearStableConnectionTimer();
      const previousSocket = socket;
      socket = null;
      previousSocket?.close();
    };
  }, [heartbeatIntervalMs, staleAfterMs, url]);

  return useCallback(() => reconnectRef.current(), []);
}
