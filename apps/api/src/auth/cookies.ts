import crypto from "node:crypto";
import { resolveAuthCookieNames } from "./cookieNames.js";

const AUTH_COOKIE_NAMES = resolveAuthCookieNames();

export const SESSION_COOKIE = AUTH_COOKIE_NAMES.session;
export const CSRF_COOKIE = AUTH_COOKIE_NAMES.csrf;
export const CSRF_HEADER = "x-csrf-token";
export const REAUTH_COOKIE = AUTH_COOKIE_NAMES.reauth;
export const SIWE_NONCE_COOKIE = AUTH_COOKIE_NAMES.siweNonce;

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
