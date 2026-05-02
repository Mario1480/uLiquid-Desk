import dns from "node:dns/promises";
import net from "node:net";

export type SafeOutboundUrlOptions = {
  production?: boolean;
  requireHttps?: boolean;
  allowPrivateNetworks?: boolean;
  timeoutMs?: number;
};

export type SafeOutboundUrlResult = {
  ok: true;
  url: string;
  timeoutMs: number;
} | {
  ok: false;
  reason: string;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 5_000;
const BLOCKED_HEADER_NAMES = new Set([
  "host",
  "cookie",
  "connection",
  "content-length",
  "forwarded",
  "transfer-encoding",
  "upgrade",
  "via"
]);

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const out = parts.map((part) => Number(part));
  if (out.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return out;
}

function ipv4FromMappedIpv6(address: string): string | null {
  const normalized = address.trim().toLowerCase();
  const prefix = "::ffff:";
  if (!normalized.startsWith(prefix)) return null;
  const candidate = normalized.slice(prefix.length);
  return parseIpv4(candidate) ? candidate : null;
}

export function isBlockedOutboundIp(address: string): boolean {
  const mapped = ipv4FromMappedIpv6(address);
  const ip = mapped ?? address.trim().toLowerCase();
  const version = net.isIP(ip);

  if (version === 4) {
    const parts = parseIpv4(ip);
    if (!parts) return true;
    const [a, b, c, d] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;
    return false;
  }

  if (version === 6) {
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    if (ip.startsWith("ff")) return true;
    return false;
  }

  return true;
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost"
    || host.endsWith(".localhost")
    || host === "metadata.google.internal"
    || host.endsWith(".internal")
  );
}

export async function validateSafeOutboundUrl(
  rawUrl: string,
  options: SafeOutboundUrlOptions = {}
): Promise<SafeOutboundUrlResult> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const requireHttps = options.requireHttps ?? production;
  const allowPrivateNetworks = options.allowPrivateNetworks === true;
  const timeoutMs = Math.min(Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);

  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl ?? "").trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }
  if (requireHttps && parsed.protocol !== "https:") {
    return { ok: false, reason: "https_required" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "url_credentials_not_allowed" };
  }
  if (isLocalHostname(parsed.hostname)) {
    return { ok: false, reason: "local_hostname_blocked" };
  }

  const directIpVersion = net.isIP(parsed.hostname);
  const addresses = directIpVersion
    ? [{ address: parsed.hostname }]
    : await dns.lookup(parsed.hostname, { all: true, verbatim: true }).catch(() => []);

  if (addresses.length === 0) {
    return { ok: false, reason: "dns_resolution_failed" };
  }
  if (!allowPrivateNetworks && addresses.some((entry) => isBlockedOutboundIp(entry.address))) {
    return { ok: false, reason: "private_network_blocked" };
  }

  return { ok: true, url: parsed.toString(), timeoutMs };
}

export function sanitizeOutboundHeaders(value: unknown, limit = 20): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey ?? "").trim().toLowerCase();
    const val = String(rawValue ?? "").trim();
    if (!key || !val) continue;
    if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(key)) continue;
    if (
      BLOCKED_HEADER_NAMES.has(key)
      || key.startsWith("proxy-")
      || key.startsWith("x-forwarded-")
      || key.startsWith("sec-")
    ) {
      continue;
    }
    out[key] = val.slice(0, 1000);
    if (Object.keys(out).length >= limit) break;
  }
  return out;
}
