import dns from "node:dns/promises";
import net from "node:net";

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_REDIRECT_LIMIT = 3;
const LEGACY_DEFAULT_USER_AGENT = "uLiquid-Desk-MarketIntelligence/1.0";
const DEFAULT_USER_AGENT = `${LEGACY_DEFAULT_USER_AGENT} (+https://desk.uliquid.vip; support@uliquid.vip)`;

export function resolveFeedUserAgent(value = process.env.RSS_USER_AGENT): string {
  const configured = String(value ?? "").trim();
  const resolved = !configured || configured === LEGACY_DEFAULT_USER_AGENT
    ? DEFAULT_USER_AGENT
    : configured;
  return resolved.slice(0, 240);
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.");
}

export function isPublicIpAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return !isPrivateIpv4(address);
  if (version === 6) return !isPrivateIpv6(address);
  return false;
}

export function validateFeedUrl(value: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("rss_invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("rss_https_required");
  if (url.username || url.password) throw new Error("rss_credentials_in_url");
  if (url.port && url.port !== "443") throw new Error("rss_nonstandard_port");
  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0 || !allowed.includes(hostname)) throw new Error("rss_host_not_allowlisted");
  if (hostname === "localhost" || hostname.endsWith(".local") || net.isIP(hostname)) {
    throw new Error("rss_private_host_blocked");
  }
  return url;
}

async function assertPublicDns(hostname: string): Promise<void> {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new Error("rss_private_address_blocked");
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("rss_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel("rss_response_too_large");
      throw new Error("rss_response_too_large");
    }
    chunks.push(next.value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export async function fetchBoundedFeed(params: {
  url: string;
  allowedHosts: string[];
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
  redirectLimit?: number;
  fetchImpl?: typeof fetch;
  skipDnsValidation?: boolean;
}): Promise<{ body: string; finalUrl: string; contentType: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abort = () => controller.abort();
  params.signal?.addEventListener("abort", abort, { once: true });
  try {
    let current = validateFeedUrl(params.url, params.allowedHosts);
    const redirectLimit = params.redirectLimit ?? DEFAULT_REDIRECT_LIMIT;
    for (let redirect = 0; redirect <= redirectLimit; redirect += 1) {
      if (!params.skipDnsValidation) await assertPublicDns(current.hostname);
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, text/calendar;q=0.9, */*;q=0.1",
          "User-Agent": resolveFeedUserAgent()
        }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirect >= redirectLimit) throw new Error("rss_redirect_limit");
        const location = response.headers.get("location");
        if (!location) throw new Error("rss_redirect_without_location");
        current = validateFeedUrl(new URL(location, current).toString(), params.allowedHosts);
        continue;
      }
      if (!response.ok) throw new Error(`rss_http_${response.status}`);
      const body = await readBoundedBody(response, params.maxBytes ?? DEFAULT_MAX_BYTES);
      return {
        body,
        finalUrl: current.toString(),
        contentType: String(response.headers.get("content-type") ?? "")
      };
    }
    throw new Error("rss_redirect_limit");
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener("abort", abort);
  }
}
