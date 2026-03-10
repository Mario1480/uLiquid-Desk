import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  LOCALE_COOKIE_NAME,
  extractLocaleFromPathname,
  resolvePreferredLocale,
  withLocalePath,
  type AppLocale
} from "./i18n/config";

const PUBLIC_PATHS = ["/login", "/register", "/reset-password", "/maintenance", "/favicon.ico"];

type SessionState = {
  valid: boolean;
  maintenanceActiveForUser: boolean;
};

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
        maintenanceActiveForUser: false
      };
    }
    const payload = await res.json().catch(() => null);
    return {
      valid: true,
      maintenanceActiveForUser: Boolean(payload?.maintenance?.activeForUser)
    };
  } catch {
    return {
      valid: false,
      maintenanceActiveForUser: false
    };
  } finally {
    clearTimeout(timeout);
  }
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
