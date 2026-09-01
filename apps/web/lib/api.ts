import { AUTH_CSRF_COOKIE_NAME, PRESALE_CSRF_COOKIE_NAME } from "./authCookies";

const DEFAULT_LOCAL_API_PORT = "4000";
const GET_RETRY_DELAYS_MS = [200, 600] as const;

const serverApi =
  process.env.API_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${DEFAULT_LOCAL_API_PORT}`;

type BrowserLocationLike = {
  protocol?: string;
  hostname?: string;
};

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function browserConfiguredApi(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.API_URL ??
    process.env.API_BASE_URL ??
    ""
  );
}

function isIpv4Host(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6Host(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "");
  return normalized.includes(":");
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1";
}

function isLocalBrowserHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    isLoopbackHost(normalized)
    || isIpv4Host(normalized)
    || isIpv6Host(normalized)
    || normalized.endsWith(".local")
    || normalized.endsWith(".localhost")
  );
}

function formatHostForUrl(host: string): string {
  const normalized = host.trim().replace(/^\[|\]$/g, "");
  return isIpv6Host(normalized) ? `[${normalized}]` : normalized;
}

function buildOrigin(protocol: string, host: string, port = ""): string {
  return `${protocol}//${formatHostForUrl(host)}${port ? `:${port}` : ""}`;
}

function buildApiSubdomainHost(browserHost: string): string {
  const normalized = browserHost.trim();
  const lower = normalized.toLowerCase();
  if (!normalized || lower.startsWith("api.")) return normalized;
  if (lower.startsWith("www.")) return `api.${normalized.slice(4)}`;
  if (lower.startsWith("app.")) return `api.${normalized.slice(4)}`;
  return `api.${normalized}`;
}

function buildUrlFromParsed(parsed: URL, options?: {
  protocol?: string;
  host?: string;
  port?: string;
}): string {
  const protocol = options?.protocol ?? parsed.protocol;
  const host = options?.host ?? parsed.hostname;
  const requestedPort = options?.port ?? parsed.port;
  const defaultPort = protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
  const port = requestedPort && requestedPort !== defaultPort ? requestedPort : "";
  return normalizeUrl(`${buildOrigin(protocol, host, port)}${parsed.pathname}${parsed.search}${parsed.hash}`);
}

export function resolveBrowserApiBase(
  configured = browserConfiguredApi(),
  locationLike?: BrowserLocationLike
): string {
  const browserLocation = locationLike ?? (typeof window !== "undefined" ? window.location : undefined);
  if (!browserLocation) return normalizeUrl(configured || serverApi);

  const browserProtocol = browserLocation.protocol || "http:";
  const browserHost = String(browserLocation.hostname ?? "").trim();
  if (!browserHost) return normalizeUrl(configured || serverApi);

  const localFallback = isLocalBrowserHost(browserHost)
    ? buildOrigin(browserProtocol, browserHost, DEFAULT_LOCAL_API_PORT)
    : buildOrigin(browserProtocol, buildApiSubdomainHost(browserHost));

  if (!configured) return localFallback;

  try {
    const parsed = new URL(configured);
    const configuredHost = parsed.hostname.trim().toLowerCase();

    if (isLocalBrowserHost(browserHost)) {
      const localPort = parsed.port && !["80", "443"].includes(parsed.port)
        ? parsed.port
        : DEFAULT_LOCAL_API_PORT;
      return buildUrlFromParsed(parsed, {
        protocol: browserProtocol,
        host: browserHost,
        port: localPort
      });
    }

    if (isLoopbackHost(configuredHost)) {
      return buildUrlFromParsed(parsed, {
        protocol: browserProtocol,
        host: buildApiSubdomainHost(browserHost)
      });
    }

    if (browserProtocol === "https:" && parsed.protocol !== "https:") {
      return buildUrlFromParsed(parsed, { protocol: "https:" });
    }

    return buildUrlFromParsed(parsed);
  } catch {
    return localFallback;
  }
}

export function getApiBaseUrl(): string {
  return typeof window === "undefined" ? normalizeUrl(serverApi) : resolveBrowserApiBase();
}

export class ApiError extends Error {
  status: number;
  payload?: any;

  constructor(message: string, status: number, payload?: any) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("failed to fetch")
    || message.includes("fetch failed")
    || message.includes("load failed")
    || message.includes("networkerror")
    || message.includes("network request failed")
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  path: string,
  body?: any
): Promise<T> {
  const apiBase = getApiBaseUrl();
  const hasBody = body !== undefined;
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfCookieName = path.startsWith("/uliq/public/")
      ? PRESALE_CSRF_COOKIE_NAME
      : AUTH_CSRF_COOKIE_NAME;
    const csrf = getCookie(csrfCookieName);
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const url = `${apiBase}${path}`;
  const init: RequestInit = {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
    credentials: "include",
    cache: "no-store"
  };
  const retryDelays = method === "GET" ? GET_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (error) {
      if (attempt < retryDelays.length && isRetryableFetchError(error)) {
        await delay(retryDelays[attempt]);
        continue;
      }
      throw error;
    }

    if (res.ok) {
      return res.json();
    }

    if (attempt < retryDelays.length && isRetryableStatus(res.status)) {
      await delay(retryDelays[attempt]);
      continue;
    }

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }

    const msg =
      payload?.message ||
      payload?.error ||
      `${method} ${path} failed (${res.status})`;

    throw new ApiError(msg, res.status, payload);
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body?: any): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPut<T>(path: string, body: any): Promise<T> {
  return request<T>("PUT", path, body);
}

export function apiPatch<T>(path: string, body: any): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

export function apiDel<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}
