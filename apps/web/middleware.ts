import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  LOCALE_COOKIE_NAME,
  extractLocaleFromPathname,
  resolvePreferredLocale,
  withLocalePath,
  type AppLocale
} from "./i18n/config";
import { assertWebEnv } from "./lib/startup-env";

assertWebEnv();

const PUBLIC_PATHS = ["/login", "/register", "/reset-password", "/maintenance", "/favicon.ico"];

type SessionState = {
  valid: boolean;
  maintenanceActiveForUser: boolean;
  isSuperadmin: boolean;
  hasAdminBackendAccess: boolean;
};

const PLATFORM_ADMIN_CORE_PATHS = [
  "/admin/users",
  "/admin/workspaces",
  "/admin/licenses",
  "/admin/alerts",
  "/admin/bots",
  "/admin/runners",
  "/admin/audit",
  "/admin/statistics",
  "/admin/system"
] as const;

const ADMIN_INTEGRATED_REDIRECTS: Array<{
  pattern: RegExp;
  target: string | ((match: RegExpMatchArray) => string);
}> = [
  { pattern: /^\/admin\/legacy$/, target: "/admin/system" },
  { pattern: /^\/admin(?:\/legacy)?\/access-section$/, target: "/admin/system/access" },
  { pattern: /^\/admin(?:\/legacy)?\/api-keys$/, target: "/admin/system/integrations/api-keys" },
  { pattern: /^\/admin(?:\/legacy)?\/exchanges$/, target: "/admin/system/integrations/exchanges" },
  { pattern: /^\/admin(?:\/legacy)?\/server-info$/, target: "/admin/system/integrations/server-info" },
  { pattern: /^\/admin(?:\/legacy)?\/smtp$/, target: "/admin/system/notifications/smtp" },
  { pattern: /^\/admin(?:\/legacy)?\/telegram$/, target: "/admin/system/notifications/telegram" },
  { pattern: /^\/admin(?:\/legacy)?\/ai-prompts$/, target: "/admin/system/ai/prompts" },
  { pattern: /^\/admin(?:\/legacy)?\/ai-trace$/, target: "/admin/system/ai/trace" },
  { pattern: /^\/admin(?:\/legacy)?\/indicator-settings$/, target: "/admin/system/ai/indicator-settings" },
  { pattern: /^\/admin(?:\/legacy)?\/prediction-defaults$/, target: "/admin/system/ai/prediction-defaults" },
  { pattern: /^\/admin(?:\/legacy)?\/prediction-refresh$/, target: "/admin/system/ai/prediction-refresh" },
  { pattern: /^\/admin(?:\/legacy)?\/strategies$/, target: "/admin/system/ai/strategies" },
  { pattern: /^\/admin(?:\/legacy)?\/strategies\/ai$/, target: "/admin/system/ai/strategies/ai" },
  { pattern: /^\/admin(?:\/legacy)?\/strategies\/ai-generator$/, target: "/admin/system/ai/strategies/ai-generator" },
  { pattern: /^\/admin(?:\/legacy)?\/strategies\/builder$/, target: "/admin/system/ai/strategies/builder" },
  { pattern: /^\/admin(?:\/legacy)?\/strategies\/local$/, target: "/admin/system/ai/strategies/local" },
  { pattern: /^\/admin(?:\/legacy)?\/grid-templates$/, target: "/admin/system/ai/grid-templates" },
  {
    pattern: /^\/admin(?:\/legacy)?\/grid-templates\/([^/]+)$/,
    target: (match) => `/admin/system/ai/grid-templates/${match[1]}`
  },
  { pattern: /^\/admin(?:\/legacy)?\/grid-hyperliquid-pilot$/, target: "/admin/system/vaults/grid-hyperliquid-pilot" },
  { pattern: /^\/admin(?:\/legacy)?\/vault-execution$/, target: "/admin/system/vaults/execution" },
  { pattern: /^\/admin(?:\/legacy)?\/vault-operations$/, target: "/admin/system/vaults/operations" },
  { pattern: /^\/admin(?:\/legacy)?\/vault-safety$/, target: "/admin/system/vaults/safety" },
  { pattern: /^\/admin(?:\/legacy)?\/billing$/, target: "/admin/licenses/packages" }
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path))) return true;
  if (pathname.startsWith("/_next") || pathname.startsWith("/images") || pathname.startsWith("/api")) return true;
  if (pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|webp)$/)) return true;
  return false;
}

function apiBaseUrl(): string {
  return (
    process.env.API_URL ??
    process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4000"
  );
}

async function getSessionState(req: NextRequest, apiBase: string): Promise<SessionState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: {
        cookie: req.headers.get("cookie") ?? ""
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) {
      return {
        valid: false,
        maintenanceActiveForUser: false,
        isSuperadmin: false,
        hasAdminBackendAccess: false
      };
    }
    const payload = await res.json().catch(() => null);
    return {
      valid: true,
      maintenanceActiveForUser: Boolean(payload?.maintenance?.activeForUser),
      isSuperadmin: Boolean(payload?.isSuperadmin),
      hasAdminBackendAccess: Boolean(payload?.isSuperadmin || payload?.hasAdminBackendAccess)
    };
  } catch {
    return {
      valid: false,
      maintenanceActiveForUser: false,
      isSuperadmin: false,
      hasAdminBackendAccess: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isLegacyAdminPath(pathnameWithoutLocale: string): boolean {
  return pathnameWithoutLocale === "/admin/legacy" || pathnameWithoutLocale.startsWith("/admin/legacy/");
}

function isPlatformAdminCorePath(pathnameWithoutLocale: string): boolean {
  if (pathnameWithoutLocale === "/admin") return true;
  return PLATFORM_ADMIN_CORE_PATHS.some((prefix) =>
    pathnameWithoutLocale === prefix || pathnameWithoutLocale.startsWith(`${prefix}/`)
  );
}

function shouldRedirectAdminPathToLegacy(pathnameWithoutLocale: string): boolean {
  if (!pathnameWithoutLocale.startsWith("/admin/")) return false;
  if (isLegacyAdminPath(pathnameWithoutLocale)) return false;
  return !isPlatformAdminCorePath(pathnameWithoutLocale);
}

function resolveIntegratedAdminRedirect(pathnameWithoutLocale: string): string | null {
  for (const entry of ADMIN_INTEGRATED_REDIRECTS) {
    const match = pathnameWithoutLocale.match(entry.pattern);
    if (!match) continue;
    return typeof entry.target === "function" ? entry.target(match) : entry.target;
  }
  return null;
}

function clearSessionCookie(resp: NextResponse): void {
  resp.cookies.set("mm_session", "", { path: "/", maxAge: 0 });
  const domain = process.env.COOKIE_DOMAIN?.trim();
  if (domain) {
    resp.cookies.set("mm_session", "", { path: "/", maxAge: 0, domain });
  }
}

function setLocaleCookie(resp: NextResponse, locale: AppLocale): void {
  resp.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}

function rewriteLocalizedRequest(req: NextRequest, internalPathname: string, locale: AppLocale): NextResponse {
  const rewriteUrl = req.nextUrl.clone();
  rewriteUrl.pathname = internalPathname;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-utrade-locale", locale);
  const resp = NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders
    }
  });
  setLocaleCookie(resp, locale);
  return resp;
}

function redirectToLocalizedPath(req: NextRequest, locale: AppLocale, pathname: string): NextResponse {
  const target = req.nextUrl.clone();
  target.pathname = withLocalePath(pathname, locale);
  const resp = NextResponse.redirect(target);
  setLocaleCookie(resp, locale);
  return resp;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const {
    locale: localeFromPath,
    pathnameWithoutLocale
  } = extractLocaleFromPathname(pathname);
  const session = req.cookies.get("mm_session");
  const apiBase = apiBaseUrl();
  const locale =
    localeFromPath ??
    resolvePreferredLocale({
      cookieLocale: req.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null,
      acceptLanguage: req.headers.get("accept-language")
    });

  if (!localeFromPath) {
    if (pathname.startsWith("/_next") || pathname.startsWith("/api")) return NextResponse.next();
    if (pathname.startsWith("/images") || pathname.match(/\.(png|jpg|jpeg|svg|gif|ico|webp)$/)) {
      return NextResponse.next();
    }
    return redirectToLocalizedPath(req, locale, pathname);
  }

  if (isPublicPath(pathnameWithoutLocale)) {
    if (pathnameWithoutLocale === "/maintenance" && session) {
      const sessionState = await getSessionState(req, apiBase);
      if (sessionState.valid && !sessionState.maintenanceActiveForUser) {
        return redirectToLocalizedPath(req, locale, "/");
      }
      if (!sessionState.valid) {
        const resp = rewriteLocalizedRequest(req, pathnameWithoutLocale, locale);
        clearSessionCookie(resp);
        return resp;
      }
    }

    if (
      (pathnameWithoutLocale === "/login"
        || pathnameWithoutLocale === "/register"
        || pathnameWithoutLocale === "/reset-password")
      && session
    ) {
      const sessionState = await getSessionState(req, apiBase);
      if (sessionState.valid) {
        if (sessionState.maintenanceActiveForUser) {
          return redirectToLocalizedPath(req, locale, "/maintenance");
        }
        return redirectToLocalizedPath(req, locale, "/");
      }

      const resp = rewriteLocalizedRequest(req, pathnameWithoutLocale, locale);
      clearSessionCookie(resp);
      return resp;
    }
    return rewriteLocalizedRequest(req, pathnameWithoutLocale, locale);
  }

  if (!session) {
    return redirectToLocalizedPath(req, locale, "/login");
  }

  const sessionState = await getSessionState(req, apiBase);
  if (sessionState.valid) {
    const integratedAdminTarget = resolveIntegratedAdminRedirect(pathnameWithoutLocale);
    if (integratedAdminTarget) {
      return redirectToLocalizedPath(req, locale, integratedAdminTarget);
    }

    if (shouldRedirectAdminPathToLegacy(pathnameWithoutLocale)) {
      if (!sessionState.isSuperadmin) {
        return redirectToLocalizedPath(req, locale, "/");
      }
      const legacyPath = `/admin/legacy${pathnameWithoutLocale.slice("/admin".length)}`;
      return redirectToLocalizedPath(req, locale, legacyPath);
    }

    if (isLegacyAdminPath(pathnameWithoutLocale) && !sessionState.isSuperadmin) {
      return redirectToLocalizedPath(req, locale, "/");
    }

    if (isPlatformAdminCorePath(pathnameWithoutLocale) && !sessionState.isSuperadmin) {
      return redirectToLocalizedPath(req, locale, "/");
    }

    if (sessionState.maintenanceActiveForUser && pathnameWithoutLocale !== "/maintenance") {
      return redirectToLocalizedPath(req, locale, "/maintenance");
    }
    return rewriteLocalizedRequest(req, pathnameWithoutLocale, locale);
  }

  const resp = redirectToLocalizedPath(req, locale, "/login");
  clearSessionCookie(resp);
  return resp;
}

export const config = {
  matcher: ["/((?!_next).*)"]
};
