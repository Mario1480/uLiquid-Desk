"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "../../lib/api";

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstilePublicConfig = { enabled: boolean; siteKey: string };

export function useTurnstileConfig(active = true) {
  const [config, setConfig] = useState<TurnstilePublicConfig | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setFailed(false);
    apiGet<TurnstilePublicConfig>("/auth/turnstile")
      .then((value) => { if (current) setConfig(value); })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [active]);

  return { config, failed };
}

export function TurnstileChallenge({
  siteKey,
  action,
  locale,
  resetKey,
  onTokenChange,
  onError
}: {
  siteKey: string;
  action: string;
  locale: string;
  resetKey: number;
  onTokenChange(value: string): void;
  onError(): void;
}) {
  const [scriptReady, setScriptReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const tokenCallbackRef = useRef(onTokenChange);
  const errorCallbackRef = useRef(onError);
  tokenCallbackRef.current = onTokenChange;
  errorCallbackRef.current = onError;
  const ready = useCallback(() => setScriptReady(true), []);

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) return;
    tokenCallbackRef.current("");
    widgetRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme: "dark",
      size: "flexible",
      language: locale,
      callback: (value: string) => tokenCallbackRef.current(value),
      "expired-callback": () => tokenCallbackRef.current(""),
      "error-callback": () => {
        tokenCallbackRef.current("");
        errorCallbackRef.current();
      }
    });
    return () => {
      if (widgetRef.current !== null) window.turnstile?.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [action, locale, resetKey, scriptReady, siteKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={ready}
        onError={() => errorCallbackRef.current()}
      />
      <div className="authTurnstile" ref={containerRef} />
    </>
  );
}
