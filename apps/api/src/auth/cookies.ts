import crypto from "node:crypto";

export const SESSION_COOKIE = "mm_session";
export const CSRF_COOKIE = "mm_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const REAUTH_COOKIE = "mm_reauth";

function cookieSecure(): boolean {
  const secureEnv = (process.env.COOKIE_SECURE ?? "").toLowerCase();
  return (
    secureEnv === "1" ||
    secureEnv === "true" ||
    (secureEnv === "" && process.env.NODE_ENV === "production")
  );
}

function cookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN?.trim() || undefined;
}

export function sessionCookieOptions(maxAgeMs: number) {
  const domain = cookieDomain();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    maxAge: maxAgeMs,
    path: "/",
    ...(domain ? { domain } : {})
  };
}

export function csrfCookieOptions(maxAgeMs: number) {
  const domain = cookieDomain();
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    maxAge: maxAgeMs,
    path: "/",
    ...(domain ? { domain } : {})
  };
}

export function clearAuthCookieOptions() {
  const domain = cookieDomain();
  return domain ? { path: "/", domain } : { path: "/" };
}

export function createCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
