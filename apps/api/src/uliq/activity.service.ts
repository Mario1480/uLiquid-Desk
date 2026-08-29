import { getUliqRuntimeConfig, type UliqRuntimeConfig } from "./config.js";

const ACTIVITY_EVENT_NAMES = [
  "PurchaseCreated",
  "PurchaseWithdrawn",
  "PurchaseFinalized",
  "TokensReleased",
  "TokensLocked",
  "LockExtended",
  "TokensUnlocked"
] as const;

type ActivityCursor = { blockNumber: string; logIndex: number };

function encodeCursor(value: ActivityCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): ActivityCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!/^\d+$/.test(String(parsed?.blockNumber)) || !Number.isInteger(parsed?.logIndex)) throw new Error("invalid");
    return { blockNumber: String(parsed.blockNumber), logIndex: parsed.logIndex };
  } catch {
    throw new Error("invalid_activity_cursor");
  }
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function belongsToWallet(payload: Record<string, unknown>, walletAddress: string): boolean {
  return [payload.buyer, payload.beneficiary, payload.owner]
    .some((value) => String(value ?? "").toLowerCase() === walletAddress);
}

function stringValue(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (payload[key] != null) return String(payload[key]);
  }
  return null;
}

function mapEvent(row: any) {
  const payload = payloadRecord(row.payload);
  const common = {
    id: String(row.id),
    eventName: String(row.eventName),
    transactionHash: String(row.transactionHash),
    blockNumber: BigInt(row.blockNumber).toString(),
    logIndex: Number(row.logIndex),
    occurredAt: row.blockTimestamp instanceof Date ? row.blockTimestamp.toISOString() : String(row.blockTimestamp),
    amountRaw: null as string | null,
    asset: "ULIQ" as "ULIQ" | "USDC",
    referenceId: stringValue(payload, "purchaseId", "lockId")
  };
  switch (row.eventName) {
    case "PurchaseCreated":
      return { ...common, type: "PRESALE_PURCHASED", amountRaw: stringValue(payload, "usdcAmountRaw"), asset: "USDC" as const };
    case "PurchaseWithdrawn":
      return { ...common, type: "PRESALE_WITHDRAWN", amountRaw: stringValue(payload, "usdcRefundRaw"), asset: "USDC" as const };
    case "PurchaseFinalized":
      return {
        ...common,
        type: "PRESALE_FINALIZED",
        amountRaw: (BigInt(stringValue(payload, "walletUliqRaw") ?? "0") + BigInt(stringValue(payload, "vestingUliqRaw") ?? "0")).toString()
      };
    case "TokensReleased":
      return { ...common, type: "VESTING_CLAIMED", amountRaw: stringValue(payload, "amount") };
    case "TokensLocked":
      return { ...common, type: "TOKENS_LOCKED", amountRaw: stringValue(payload, "amount") };
    case "LockExtended":
      return { ...common, type: "LOCK_EXTENDED", amountRaw: null };
    case "TokensUnlocked":
      return { ...common, type: "TOKENS_UNLOCKED", amountRaw: stringValue(payload, "amount") };
    default:
      return { ...common, type: "UNKNOWN" };
  }
}

export class UliqActivityService {
  constructor(
    private readonly db: any,
    private readonly config: UliqRuntimeConfig = getUliqRuntimeConfig()
  ) {}

  async listForUser(params: { userId: string; limit?: number; cursor?: string }) {
    const user = await this.db.user.findUnique({ where: { id: params.userId }, select: { walletAddress: true } });
    if (!user?.walletAddress) throw new Error("wallet_not_linked");
    const walletAddress = String(user.walletAddress).toLowerCase();
    const limit = Math.max(1, Math.min(50, params.limit ?? 5));
    const decodedCursor = decodeCursor(params.cursor);
    const items: ReturnType<typeof mapEvent>[] = [];
    let scanCursor = decodedCursor;
    let exhausted = false;

    for (let batch = 0; batch < 10 && items.length <= limit && !exhausted; batch += 1) {
      const rows = await this.db.onchainIndexedEvent.findMany({
        where: {
          chainId: this.config.chainId,
          canonicalStatus: "FINALIZED",
          eventName: { in: [...ACTIVITY_EVENT_NAMES] },
          blockTimestamp: { not: null },
          ...(scanCursor ? {
            OR: [
              { blockNumber: { lt: BigInt(scanCursor.blockNumber) } },
              { blockNumber: BigInt(scanCursor.blockNumber), logIndex: { lt: scanCursor.logIndex } }
            ]
          } : {})
        },
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        take: 100
      });
      exhausted = rows.length < 100;
      for (const row of rows) {
        scanCursor = { blockNumber: BigInt(row.blockNumber).toString(), logIndex: Number(row.logIndex) };
        const payload = payloadRecord(row.payload);
        if (belongsToWallet(payload, walletAddress)) items.push(mapEvent(row));
        if (items.length > limit) break;
      }
    }

    const missingTimestampRows = await this.db.onchainIndexedEvent.findMany({
      where: {
        chainId: this.config.chainId,
        canonicalStatus: "FINALIZED",
        eventName: { in: [...ACTIVITY_EVENT_NAMES] },
        blockTimestamp: null
      },
      select: { payload: true },
      take: 500
    });
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      walletAddress,
      items: page,
      nextCursor: items.length > limit && last
        ? encodeCursor({ blockNumber: last.blockNumber, logIndex: last.logIndex })
        : null,
      partial: missingTimestampRows.some((row: any) => belongsToWallet(payloadRecord(row.payload), walletAddress))
    };
  }
}
