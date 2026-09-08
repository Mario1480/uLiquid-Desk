import type { Request } from "express";

export type TurnstileConfig = {
  hostnames: string[];
  siteKey: string;
  secret: string;
  ready: boolean;
};

export class TurnstileError extends Error {
  constructor(public code: "turnstile_invalid" | "turnstile_unavailable", public status: number) {
    super(code);
  }
}

export function turnstileConfig(env = process.env): TurnstileConfig {
  const hostnames = (env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const secret = env.TURNSTILE_SECRET_KEY ?? "";
  const productionTestKey = env.NODE_ENV === "production" && /^[123]x0{10}/.test(siteKey);
  return {
    hostnames,
    siteKey,
    secret,
    ready: hostnames.length > 0 && Boolean(siteKey && secret) && !productionTestKey
  };
}

function requestIp(req?: Request): string | undefined {
  const value = String(req?.ip ?? "").trim();
  return value || undefined;
}

export async function verifyTurnstile(
  token: string,
  action: string,
  req?: Request,
  config = turnstileConfig(),
  fetcher = fetch
): Promise<void> {
  if (!config.ready) throw new TurnstileError("turnstile_unavailable", 503);
  if (!token) throw new TurnstileError("turnstile_invalid", 400);
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.secret,
        response: token,
        ...(requestIp(req) ? { remoteip: requestIp(req) } : {})
      }),
      signal: AbortSignal.timeout(5000)
    });
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    const hostname = String(result.hostname ?? "").trim().toLowerCase();
    if (!response.ok || result.success !== true || result.action !== action || !config.hostnames.includes(hostname)) {
      throw new TurnstileError("turnstile_invalid", 400);
    }
  } catch (error) {
    if (error instanceof TurnstileError) throw error;
    throw new TurnstileError("turnstile_unavailable", 503);
  }
}
