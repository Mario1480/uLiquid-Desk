export const DEFAULT_AUTH_COOKIE_PREFIX = "mm";

const AUTH_COOKIE_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export type AuthCookieNames = {
  prefix: string;
  session: string;
  csrf: string;
  presaleSession: string;
  presaleCsrf: string;
};

export function validateAuthCookiePrefix(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!AUTH_COOKIE_PREFIX_PATTERN.test(normalized)) {
    return "must start with a letter and contain only letters, digits, underscores, or hyphens (max 32 characters)";
  }
  return null;
}

export function resolveAuthCookieNames(
  configuredPrefix: string | null | undefined
): AuthCookieNames {
  const prefix = String(configuredPrefix ?? "").trim() || DEFAULT_AUTH_COOKIE_PREFIX;
  const validationError = validateAuthCookiePrefix(prefix);
  if (validationError) {
    throw new Error(`Invalid NEXT_PUBLIC_AUTH_COOKIE_PREFIX: ${validationError}.`);
  }
  return {
    prefix,
    session: `${prefix}_session`,
    csrf: `${prefix}_csrf`,
    presaleSession: `${prefix}_presale_session`,
    presaleCsrf: `${prefix}_presale_csrf`
  };
}

const AUTH_COOKIE_NAMES = resolveAuthCookieNames(
  process.env.NEXT_PUBLIC_AUTH_COOKIE_PREFIX
);

export const AUTH_SESSION_COOKIE_NAME = AUTH_COOKIE_NAMES.session;
export const AUTH_CSRF_COOKIE_NAME = AUTH_COOKIE_NAMES.csrf;
export const PRESALE_SESSION_COOKIE_NAME = AUTH_COOKIE_NAMES.presaleSession;
export const PRESALE_CSRF_COOKIE_NAME = AUTH_COOKIE_NAMES.presaleCsrf;
