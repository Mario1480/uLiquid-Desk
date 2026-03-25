export const HYPERLIQUID_CREDENTIAL_ROTATION_DAYS = 180;
export const HYPERLIQUID_CREDENTIAL_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type HyperliquidCredentialExpiryState = "healthy" | "warning" | "expired";

export type HyperliquidCredentialExpiryMeta = {
  credentialsRotatedAt: string | null;
  credentialsExpiresAt: string | null;
  credentialsExpiresInDays: number | null;
  credentialExpiryState: HyperliquidCredentialExpiryState | null;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function isHyperliquidExchange(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "hyperliquid";
}

export function resolveHyperliquidCredentialsRotatedAt(input: {
  exchange: unknown;
  credentialsRotatedAt?: unknown;
  createdAt?: unknown;
}): Date | null {
  if (!isHyperliquidExchange(input.exchange)) return null;
  return toDate(input.credentialsRotatedAt) ?? toDate(input.createdAt);
}

export function calculateHyperliquidCredentialsExpiresAt(rotatedAt: Date | null): Date | null {
  if (!rotatedAt) return null;
  return new Date(rotatedAt.getTime() + HYPERLIQUID_CREDENTIAL_ROTATION_DAYS * DAY_MS);
}

export function calculateHyperliquidCredentialsExpiresInDays(expiresAt: Date | null, now: Date): number | null {
  if (!expiresAt) return null;
  const diffDays = (expiresAt.getTime() - now.getTime()) / DAY_MS;
  if (diffDays >= 0) return Math.ceil(diffDays);
  return Math.floor(diffDays);
}

export function deriveHyperliquidCredentialExpiryState(params: {
  exchange: unknown;
  credentialsRotatedAt?: unknown;
  createdAt?: unknown;
  now?: Date;
}): HyperliquidCredentialExpiryMeta {
  if (!isHyperliquidExchange(params.exchange)) {
    return {
      credentialsRotatedAt: null,
      credentialsExpiresAt: null,
      credentialsExpiresInDays: null,
      credentialExpiryState: null
    };
  }

  const now = params.now ?? new Date();
  const rotatedAt = resolveHyperliquidCredentialsRotatedAt(params);
  const expiresAt = calculateHyperliquidCredentialsExpiresAt(rotatedAt);
  const expiresInDays = calculateHyperliquidCredentialsExpiresInDays(expiresAt, now);

  let state: HyperliquidCredentialExpiryState | null = "healthy";
  if (!rotatedAt || !expiresAt || expiresInDays === null) {
    state = null;
  } else if (expiresAt.getTime() <= now.getTime()) {
    state = "expired";
  } else if (expiresInDays <= HYPERLIQUID_CREDENTIAL_WARNING_DAYS) {
    state = "warning";
  }

  return {
    credentialsRotatedAt: toIso(rotatedAt),
    credentialsExpiresAt: toIso(expiresAt),
    credentialsExpiresInDays: expiresInDays,
    credentialExpiryState: state
  };
}

export function shouldSendHyperliquidCredentialExpiryReminder(params: {
  exchange: unknown;
  credentialsRotatedAt?: unknown;
  credentialsExpiryNoticeSentAt?: unknown;
  createdAt?: unknown;
  now?: Date;
}): boolean {
  if (!isHyperliquidExchange(params.exchange)) return false;
  if (toDate(params.credentialsExpiryNoticeSentAt)) return false;
  const meta = deriveHyperliquidCredentialExpiryState(params);
  return meta.credentialExpiryState === "warning" || meta.credentialExpiryState === "expired";
}
