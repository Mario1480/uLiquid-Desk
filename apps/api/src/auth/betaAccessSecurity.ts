import { createHash } from "node:crypto";
import { Redis } from "ioredis";

export const betaHash = (value: string) => createHash("sha256").update(value).digest("hex");
export class BetaAccessError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function betaConfig(env = process.env) {
  const origin = env.BETA_ACCESS_WEB_ORIGIN ?? "";
  let validOrigin = false;
  try {
    const url = new URL(origin);
    validOrigin = url.origin === origin && (url.protocol === "https:" || (env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { /* An invalid origin keeps public intake closed. */ }
  const hostnames = (env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map(v => v.trim()).filter(Boolean);
  return {
    origin, hostnames, siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    secret: env.TURNSTILE_SECRET_KEY ?? "",
    ready: validOrigin && hostnames.length > 0 && Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)
      && !(env.NODE_ENV === "production" && /^[123]x0{10}/.test(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""))
      && env.BETA_ACCESS_PRIVACY_APPROVED === "true"
  };
}

export async function verifyBetaTurnstile(token: string, action: string, config = betaConfig(), fetcher = fetch) {
  if (!config.ready) throw new BetaAccessError("beta_unavailable", 503);
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: config.secret, response: token }), signal: AbortSignal.timeout(5000)
    });
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    if (!response.ok || result.success !== true || result.action !== action || !config.hostnames.includes(result.hostname ?? "")) {
      throw new BetaAccessError("beta_bot_check_failed");
    }
  } catch (error) {
    if (error instanceof BetaAccessError) throw error;
    throw new BetaAccessError("beta_unavailable", 503);
  }
}

// All quotas are checked before any counters change, in one atomic Redis operation.
export const BETA_LIMIT_SCRIPT = `
for i,key in ipairs(KEYS) do
  if tonumber(redis.call('GET',key) or '0') >= tonumber(ARGV[(i-1)*2+1]) then return 0 end
end
for i,key in ipairs(KEYS) do
  local n=redis.call('INCR',key)
  if n==1 then redis.call('PEXPIRE',key,ARGV[(i-1)*2+2]) end
end
return 1`;

export type BetaLimit = (kind: "ip" | "mail" | "verify" | "adminMail", key: string) => Promise<void>;
export function createBetaLimiter(): BetaLimit {
  let redis: Redis | undefined;
  return async (kind, key) => {
    const url = process.env.API_RATE_LIMIT_REDIS_URL ?? process.env.REDIS_URL;
    if (!url) throw new BetaAccessError("beta_unavailable", 503);
    if (!redis) {
      redis = new Redis(url, { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true, connectTimeout: 2000, commandTimeout: 2000 });
      redis.on("error", () => { /* Fail closed without logging connection secrets. */ });
    }
    const prefix = "beta:{access}:";
    const hash = betaHash(key);
    const quotas: [string, number, number][] = kind === "ip" ? [[`ip:${hash}`, 5, 900000]]
      : kind === "verify" ? [[`verify:${hash}`, 30, 900000]]
      : kind === "adminMail" ? [["global-mail", 100, 3600000], [`mail-gap:${hash}`, 1, 60000]]
      : [["global-mail", 100, 3600000], [`mail:${hash}`, 3, 86400000], [`mail-gap:${hash}`, 1, 60000]];
    try {
      if (redis.status === "wait") await redis.connect();
      const result = await redis.eval(BETA_LIMIT_SCRIPT, quotas.length, ...quotas.map(q => prefix + q[0]), ...quotas.flatMap(q => [q[1], q[2]]));
      if (Number(result) !== 1) throw new BetaAccessError("beta_rate_limited", 429);
    } catch (error) {
      if (error instanceof BetaAccessError) throw error;
      throw new BetaAccessError("beta_unavailable", 503);
    }
  };
}
