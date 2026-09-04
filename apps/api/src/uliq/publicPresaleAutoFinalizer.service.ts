import { logger } from "../logger.js";
import { getUliqAutoFinalizerSettings, UliqAutoFinalizerService } from "./autoFinalizer.service.js";
import {
  getUliqPublicPresaleConfig,
  type UliqPublicPresaleConfig,
  type UliqPublicPresaleRoundId
} from "./publicPresale.config.js";
import { createUliqRpcPair, getConsistentFinalizedBlock, type UliqRpcPair } from "./rpc.js";

export type UliqPublicPresaleAutoFinalizerMode = "OFF" | "OBSERVE" | "ACTIVE";

export type UliqPublicPresaleAutoFinalizerSettings = {
  mode: UliqPublicPresaleAutoFinalizerMode;
  intervalMs: number;
  drainIntervalMs: number;
  batchSize: number;
  retryBaseMs: number;
  retryMaxMs: number;
  submissionStaleMs: number;
};

type Deps = {
  config?: UliqPublicPresaleConfig;
  settings?: UliqPublicPresaleAutoFinalizerSettings;
  rpc?: UliqRpcPair;
  privateKey?: `0x${string}`;
  createRoundService?: (roundAddress: `0x${string}`) => Pick<UliqAutoFinalizerService, "runOnce">;
};

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`uliq_public_presale_auto_finalizer_invalid_${name}`);
  }
  return parsed;
}

function mode(value: string | undefined): UliqPublicPresaleAutoFinalizerMode {
  const normalized = String(value ?? "OFF").trim().toUpperCase();
  if (normalized === "OFF" || normalized === "OBSERVE" || normalized === "ACTIVE") return normalized;
  throw new Error("uliq_public_presale_auto_finalizer_invalid_mode");
}

function privateKey(value: string | undefined): `0x${string}` {
  const normalized = String(value ?? "").trim();
  if (!/^(?:0x)?[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("uliq_public_presale_auto_finalizer_private_key_invalid");
  }
  return (normalized.startsWith("0x") ? normalized : `0x${normalized}`) as `0x${string}`;
}

export function getUliqPublicPresaleAutoFinalizerSettings(
  env: NodeJS.ProcessEnv = process.env
): UliqPublicPresaleAutoFinalizerSettings {
  const legacy = getUliqAutoFinalizerSettings({
    ULIQ_AUTO_FINALIZER_ENABLED: "true",
    ULIQ_AUTO_FINALIZER_BATCH_SIZE: env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_BATCH_SIZE,
    ULIQ_AUTO_FINALIZER_RETRY_SECONDS: env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_RETRY_SECONDS,
    ULIQ_AUTO_FINALIZER_MAX_RETRY_SECONDS: env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_MAX_RETRY_SECONDS,
    ULIQ_AUTO_FINALIZER_SUBMISSION_STALE_SECONDS:
      env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_SUBMISSION_STALE_SECONDS
  });
  return {
    mode: mode(env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_MODE),
    intervalMs: integer(
      env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_INTERVAL_SECONDS,
      900,
      60,
      3_600,
      "interval_seconds"
    ) * 1_000,
    drainIntervalMs: integer(
      env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_DRAIN_INTERVAL_SECONDS,
      5,
      5,
      300,
      "drain_interval_seconds"
    ) * 1_000,
    batchSize: integer(
      env.ULIQ_PUBLIC_PRESALE_AUTO_FINALIZER_BATCH_SIZE,
      25,
      1,
      50,
      "batch_size"
    ),
    retryBaseMs: legacy.retryBaseMs,
    retryMaxMs: legacy.retryMaxMs,
    submissionStaleMs: legacy.submissionStaleMs
  };
}

export class UliqPublicPresaleAutoFinalizerService {
  private readonly config: UliqPublicPresaleConfig;
  private readonly settings: UliqPublicPresaleAutoFinalizerSettings;
  private readonly rpc: UliqRpcPair;
  private readonly roundServices: Array<Pick<UliqAutoFinalizerService, "runOnce">>;

  constructor(private readonly db: any, deps: Deps = {}) {
    this.config = deps.config ?? getUliqPublicPresaleConfig();
    this.settings = deps.settings ?? getUliqPublicPresaleAutoFinalizerSettings();
    this.rpc = deps.rpc ?? createUliqRpcPair(this.config);

    const signerKey = this.settings.mode === "ACTIVE"
      ? deps.privateKey ?? privateKey(process.env.ULIQ_PUBLIC_PRESALE_FINALIZER_PRIVATE_KEY)
      : undefined;
    this.roundServices = this.config.rounds.map((round) => deps.createRoundService?.(round.contractAddress)
      ?? new UliqAutoFinalizerService(
        this.db,
        {
          chainId: this.config.chainId,
          primaryRpcUrl: this.config.primaryRpcUrl,
          secondaryRpcUrl: this.config.secondaryRpcUrl,
          contracts: { presale: round.contractAddress }
        },
        {
          settings: {
            enabled: true,
            batchSize: this.settings.batchSize,
            retryBaseMs: this.settings.retryBaseMs,
            retryMaxMs: this.settings.retryMaxMs,
            submissionStaleMs: this.settings.submissionStaleMs
          },
          privateKey: signerKey
        }
      ));
  }

  getMode(): UliqPublicPresaleAutoFinalizerMode {
    return this.settings.mode;
  }

  getIntervals(): { intervalMs: number; drainIntervalMs: number } {
    return { intervalMs: this.settings.intervalMs, drainIntervalMs: this.settings.drainIntervalMs };
  }

  async runOnce(): Promise<Record<string, unknown>> {
    if (this.settings.mode === "OFF") return { mode: "OFF", enabled: false, hasMore: false };
    if (this.settings.mode === "OBSERVE") return this.observe();

    const rounds: Array<Record<string, unknown> & { roundId: string }> = [];
    for (let index = 0; index < this.roundServices.length; index += 1) {
      rounds.push({
        roundId: this.config.rounds[index].id,
        ...await this.roundServices[index].runOnce()
      });
    }
    await this.updateOperationalAlerts(rounds).catch((error) => {
      logger.warn("uliq_public_presale_finalizer_monitoring_failed", {
        reason: error instanceof Error ? error.message : String(error)
      });
    });
    return {
      mode: "ACTIVE",
      enabled: true,
      hasMore: rounds.some((round) => round.hasMore === true),
      rounds
    };
  }

  private async updateOperationalAlerts(rounds: Array<Record<string, unknown>>): Promise<void> {
    if (typeof this.db?.platformAlert?.findFirst !== "function") return;
    const hasBacklog = rounds.some((round) => round.hasMore === true);
    await this.setAlert(
      "uliq_public_presale_finalizer_backlog",
      hasBacklog,
      "warning",
      "ULIQ Presale finalizer backlog",
      "Eligible Presale purchases remain queued after the current finalizer batch.",
      { rounds }
    );

    const reviewRequired = await this.db.onchainAction.findMany({
      where: {
        actionType: "uliq_finalize_purchase",
        chainId: this.config.chainId,
        toAddress: { in: this.config.rounds.map((round) => round.contractAddress.toLowerCase()) },
        status: "review_required"
      },
      select: { id: true, toAddress: true, metadata: true },
      take: 100
    }).catch(() => []);
    await this.setAlert(
      "uliq_public_presale_finalizer_review_required",
      reviewRequired.length > 0,
      "critical",
      "ULIQ Presale finalization requires review",
      `${reviewRequired.length} automatic Presale finalization action(s) require manual review.`,
      { actions: reviewRequired }
    );

    const finalizerAddress = rounds.map((round) => String(round.finalizerAddress ?? ""))
      .find((value) => /^0x[0-9a-fA-F]{40}$/.test(value)) as `0x${string}` | undefined;
    const finalizedBlockNumber = rounds.map((round) => String(round.finalizedBlockNumber ?? ""))
      .find((value) => /^\d+$/.test(value));
    if (!finalizerAddress || !finalizedBlockNumber) return;
    const blockNumber = BigInt(finalizedBlockNumber);
    const [primaryBalance, secondaryBalance] = await Promise.all([
      this.rpc.primary.getBalance({ address: finalizerAddress, blockNumber }),
      this.rpc.secondary.getBalance({ address: finalizerAddress, blockNumber })
    ]);
    const minimumGasBalance = 10n ** 16n;
    const balanceMismatch = primaryBalance !== secondaryBalance;
    await this.setAlert(
      "uliq_public_presale_finalizer_gas",
      balanceMismatch || primaryBalance < minimumGasBalance,
      balanceMismatch ? "critical" : "warning",
      "ULIQ Presale finalizer gas balance",
      balanceMismatch
        ? "Finalizer gas balances differ between the configured RPC providers."
        : "The ULIQ Presale finalizer wallet is below the 0.01 ETH operating threshold.",
      {
        finalizerAddress,
        blockNumber: blockNumber.toString(),
        primaryBalanceWei: primaryBalance.toString(),
        secondaryBalanceWei: secondaryBalance.toString(),
        minimumBalanceWei: minimumGasBalance.toString()
      }
    );
  }

  private async setAlert(
    type: string,
    active: boolean,
    severity: string,
    title: string,
    message: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const source = "uliq_public_presale_finalizer";
    const existing = await this.db.platformAlert.findFirst({
      where: { source, type, status: { in: ["open", "acknowledged"] } },
      orderBy: { createdAt: "desc" }
    }).catch(() => null);
    if (!active) {
      if (existing?.id) {
        await this.db.platformAlert.update({
          where: { id: existing.id },
          data: { status: "resolved", resolvedAt: new Date() }
        }).catch(() => undefined);
      }
      return;
    }
    const data = { severity, status: "open", type, source, title, message, metadata };
    if (existing?.id) {
      await this.db.platformAlert.update({ where: { id: existing.id }, data }).catch(() => undefined);
    } else {
      await this.db.platformAlert.create({ data }).catch(() => undefined);
    }
  }

  private async observe(): Promise<Record<string, unknown>> {
    const head = await getConsistentFinalizedBlock(this.rpc);
    const cutoff = new Date(Number(head.timestamp) * 1_000);
    const rounds: Array<{ roundId: UliqPublicPresaleRoundId; eligible: number }> = [];
    for (const round of this.config.rounds) {
      const candidates = await this.db.uliqPresalePurchase.findMany({
        where: {
          chainId: this.config.chainId,
          presaleContractAddress: round.contractAddress.toLowerCase(),
          status: "PENDING_WITHDRAWAL",
          withdrawalDeadline: { lt: cutoff }
        },
        select: { id: true },
        take: 5_000
      });
      rounds.push({ roundId: round.id, eligible: candidates.length });
    }
    return {
      mode: "OBSERVE",
      enabled: true,
      hasMore: false,
      finalizedBlockNumber: head.number.toString(),
      finalizedBlockHash: head.hash,
      finalizedTimestamp: head.timestamp.toString(),
      rounds
    };
  }
}
