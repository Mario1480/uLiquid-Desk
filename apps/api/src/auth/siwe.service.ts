import crypto from "node:crypto";
import { SiweMessage, generateNonce } from "siwe";

export const SIWE_NONCE_COOKIE = "mm_siwe_nonce";
const DEFAULT_NONCE_TTL_MIN = 10;
const DEFAULT_ALLOWED_CHAIN_IDS = [999, 42161];

export class SiweServiceError extends Error {
  code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "SiweServiceError";
    this.code = code;
  }
}

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeDomain(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";

  const direct = raw.split("/")[0] ?? "";
  if (!raw.includes("://")) return direct;

  try {
    const parsed = new URL(raw);
    return parsed.host.trim().toLowerCase();
  } catch {
    return direct;
  }
}

function stripPort(host: string): string {
  const value = host.trim().toLowerCase();
  if (!value) return "";
  const idx = value.indexOf(":");
  if (idx <= 0) return value;
  return value.slice(0, idx);
}

function normalizeAddressLower(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    throw new SiweServiceError("siwe_address_invalid");
  }
  return normalized.toLowerCase();
}

function parseNonceTtlMin(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_NONCE_TTL_MIN);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_NONCE_TTL_MIN;
  return Math.max(1, Math.min(60, Math.floor(parsed)));
}

function parseAllowedChainIds(raw: string | undefined): number[] {
  const parsed = String(raw ?? "")
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

  if (parsed.length > 0) {
    return Array.from(new Set(parsed));
  }

  return DEFAULT_ALLOWED_CHAIN_IDS;
}

function parseAllowedDomains(raw: string | undefined): string[] {
  const domains = String(raw ?? "")
    .split(",")
    .map((entry) => normalizeDomain(entry))
    .filter(Boolean);

  return Array.from(new Set(domains));
}

function resolveCookieSecureFlag(): boolean {
  const secureEnv = (process.env.COOKIE_SECURE ?? "").toLowerCase();
  if (secureEnv === "1" || secureEnv === "true") return true;
  if (secureEnv === "0" || secureEnv === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function buildSiweNonceCookieOptions(maxAgeMs: number) {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: resolveCookieSecureFlag(),
    maxAge: maxAgeMs,
    path: "/",
    ...(domain ? { domain } : {})
  };
}

export function clearSiweNonceCookie(res: {
  clearCookie: (name: string, options?: Record<string, unknown>) => void;
}) {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  res.clearCookie(SIWE_NONCE_COOKIE, domain ? { path: "/", domain } : { path: "/" });
}

export type VerifySiweInput = {
  message: string;
  signature: string;
  nonceToken: string | null | undefined;
  requestHost: string | null | undefined;
  expectedAddress?: string | null;
};

export type VerifiedSiwePayload = {
  address: string;
  chainId: number;
  domain: string;
  nonce: string;
  issuedAt: string;
};

export type SiweService = ReturnType<typeof createSiweService>;

export function createSiweService(db: any) {
  const nonceTtlMin = parseNonceTtlMin(process.env.SIWE_NONCE_TTL_MIN);
  const allowedChainIds = parseAllowedChainIds(process.env.SIWE_ALLOWED_CHAIN_IDS);
  const allowedDomains = parseAllowedDomains(process.env.SIWE_ALLOWED_DOMAINS);

  async function issueNonce(params?: { issuedForUserId?: string | null }) {
    const nonce = generateNonce();
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + nonceTtlMin * 60_000);

    await db.siweNonce.create({
      data: {
        tokenHash: hashValue(token),
        nonceHash: hashValue(nonce),
        expiresAt,
        issuedForUserId: params?.issuedForUserId ?? null
      }
    });

    return {
      nonce,
      expiresAt,
      token,
      ttlMs: nonceTtlMin * 60_000
    };
  }

  async function verify(input: VerifySiweInput): Promise<VerifiedSiwePayload> {
    const messageRaw = String(input.message ?? "").trim();
    const signature = String(input.signature ?? "").trim();
    const nonceToken = String(input.nonceToken ?? "").trim();

    if (!messageRaw || !signature) {
      throw new SiweServiceError("invalid_payload");
    }
    if (!nonceToken) {
      throw new SiweServiceError("siwe_nonce_missing");
    }

    let parsedMessage: SiweMessage;
    try {
      parsedMessage = new SiweMessage(messageRaw);
    } catch {
      throw new SiweServiceError("siwe_message_invalid");
    }

    const nonce = String(parsedMessage.nonce ?? "").trim();
    if (!nonce) {
      throw new SiweServiceError("siwe_nonce_invalid");
    }

    const now = new Date();
    const row = await db.siweNonce.findUnique({
      where: {
        tokenHash: hashValue(nonceToken)
      }
    });

    if (!row) {
      throw new SiweServiceError("siwe_nonce_invalid");
    }
    if (row.consumedAt) {
      throw new SiweServiceError("siwe_nonce_consumed");
    }
    if (new Date(row.expiresAt).getTime() <= now.getTime()) {
      throw new SiweServiceError("siwe_nonce_expired");
    }

    const consumed = await db.siweNonce.updateMany({
      where: {
        id: row.id,
        consumedAt: null,
        expiresAt: {
          gt: now
        }
      },
      data: {
        consumedAt: now
      }
    });

    if (Number(consumed.count ?? 0) !== 1) {
      throw new SiweServiceError("siwe_nonce_consumed");
    }

    if (row.nonceHash !== hashValue(nonce)) {
      throw new SiweServiceError("siwe_nonce_invalid");
    }

    const chainId = Number(parsedMessage.chainId ?? 0);
    if (!Number.isInteger(chainId) || !allowedChainIds.includes(chainId)) {
      throw new SiweServiceError("siwe_chain_not_allowed");
    }

    const domain = normalizeDomain(parsedMessage.domain);
    if (!domain) {
      throw new SiweServiceError("siwe_domain_invalid");
    }

    if (allowedDomains.length > 0) {
      if (!allowedDomains.includes(domain)) {
        throw new SiweServiceError("siwe_domain_not_allowed");
      }
    } else {
      const host = normalizeDomain(input.requestHost);
      if (!host) {
        throw new SiweServiceError("siwe_domain_not_allowed");
      }
      const domainNoPort = stripPort(domain);
      const hostNoPort = stripPort(host);
      if (domain !== host && domainNoPort !== hostNoPort) {
        throw new SiweServiceError("siwe_domain_not_allowed");
      }
    }

    try {
      await parsedMessage.verify({
        signature,
        nonce
      });
    } catch {
      throw new SiweServiceError("siwe_signature_invalid");
    }

    const address = normalizeAddressLower(parsedMessage.address);
    if (input.expectedAddress) {
      const expected = normalizeAddressLower(input.expectedAddress);
      if (address !== expected) {
        throw new SiweServiceError("siwe_address_mismatch");
      }
    }

    return {
      address,
      chainId,
      domain,
      nonce,
      issuedAt: String(parsedMessage.issuedAt ?? "")
    };
  }

  return {
    issueNonce,
    verify,
    buildNonceCookieOptions: (ttlMs?: number) => buildSiweNonceCookieOptions(ttlMs ?? nonceTtlMin * 60_000),
    clearNonceCookie: clearSiweNonceCookie,
    getConfig: () => ({
      nonceTtlMin,
      allowedChainIds: [...allowedChainIds],
      allowedDomains: [...allowedDomains]
    })
  };
}
