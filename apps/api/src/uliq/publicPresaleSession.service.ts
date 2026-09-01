import crypto from "node:crypto";

export const ULIQ_PUBLIC_PRESALE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

function hashToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitize(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeWalletAddress(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized) || /^0x0{40}$/i.test(normalized)) {
    throw new Error("invalid_wallet_address");
  }
  return normalized.toLowerCase();
}

export type UliqPublicPresaleSessionContext = {
  id: string;
  walletAddress: string;
  chainId: number;
  expiresAt: Date;
};

export class UliqPublicPresaleSessionService {
  constructor(private readonly db: any) {}

  async create(params: {
    walletAddress: string;
    chainId: number;
    ipAddress?: unknown;
    userAgent?: unknown;
  }) {
    const walletAddress = normalizeWalletAddress(params.walletAddress);
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + ULIQ_PUBLIC_PRESALE_SESSION_TTL_MS);
    const session = await this.db.uliqPresaleSession.create({
      data: {
        tokenHash: hashToken(token),
        walletAddress,
        chainId: params.chainId,
        expiresAt,
        ipAddress: sanitize(params.ipAddress, 128),
        userAgent: sanitize(params.userAgent, 512)
      }
    });
    return { token, expiresAt, session: this.context(session) };
  }

  async resolve(tokenInput: unknown): Promise<UliqPublicPresaleSessionContext | null> {
    const token = String(tokenInput ?? "").trim();
    if (!token) return null;
    const row = await this.db.uliqPresaleSession.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    await this.db.uliqPresaleSession.update({
      where: { id: row.id },
      data: { lastActiveAt: new Date() }
    });
    return this.context(row);
  }

  async revoke(tokenInput: unknown): Promise<void> {
    const token = String(tokenInput ?? "").trim();
    if (!token) return;
    await this.db.uliqPresaleSession.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  async getTermsAcceptance(session: UliqPublicPresaleSessionContext, terms: {
    version: string | null;
    textHash: string | null;
  }) {
    if (!terms.version || !terms.textHash) return null;
    return this.db.uliqPresaleLegalAcknowledgement.findUnique({
      where: {
        walletAddress_chainId_version_textHash: {
          walletAddress: session.walletAddress,
          chainId: session.chainId,
          version: terms.version,
          textHash: terms.textHash
        }
      }
    });
  }

  async acceptTerms(params: {
    session: UliqPublicPresaleSessionContext;
    version: string;
    textHash: string;
    ipAddress?: unknown;
    userAgent?: unknown;
  }) {
    return this.db.uliqPresaleLegalAcknowledgement.upsert({
      where: {
        walletAddress_chainId_version_textHash: {
          walletAddress: params.session.walletAddress,
          chainId: params.session.chainId,
          version: params.version,
          textHash: params.textHash
        }
      },
      create: {
        walletAddress: params.session.walletAddress,
        chainId: params.session.chainId,
        version: params.version,
        textHash: params.textHash,
        ipAddress: sanitize(params.ipAddress, 128),
        userAgent: sanitize(params.userAgent, 512)
      },
      update: {}
    });
  }

  private context(row: any): UliqPublicPresaleSessionContext {
    return {
      id: String(row.id),
      walletAddress: String(row.walletAddress).toLowerCase(),
      chainId: Number(row.chainId),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt)
    };
  }
}
