import "dotenv/config";
import { prisma } from "@mm/db";
import { createBotVaultTradingReconciliationService } from "../vaults/tradingReconciliation.service.js";

type Summary = {
  mode: "single" | "batch";
  botVaultId: string | null;
  reportOnly: boolean;
  scanned: number;
  processed: number;
  failed: number;
  newOrders: number;
  newFills: number;
  newFundingEvents: number;
  reportReady: boolean;
  auditItems: number;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readArg(name: string): string | undefined {
  const inline = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1).trim();
  const idx = process.argv.indexOf(name);
  if (idx >= 0) {
    const next = process.argv[idx + 1];
    if (next && !next.startsWith("--")) return next.trim();
  }
  return undefined;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id <id> [--report-only] [--fills-limit <n>] [--audit-limit <n>]",
      "  npm -w apps/api run vaults:reconcile:all -- [--limit <n>]",
      "",
      "Examples:",
      "  npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id bv_123",
      "  npm -w apps/api run vaults:reconcile:bot -- --bot-vault-id bv_123 --report-only --audit-limit 100",
      "  npm -w apps/api run vaults:reconcile:all -- --limit 50"
    ].join("\n")
  );
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const runAll = hasFlag("--all");
  const botVaultId = readArg("--bot-vault-id");
  const reportOnly = hasFlag("--report-only");
  const limit = parseLimit(readArg("--limit"), 100);
  const fillsLimit = parseLimit(readArg("--fills-limit"), 20);
  const auditLimit = parseLimit(readArg("--audit-limit"), 50);

  if (!botVaultId && !runAll) {
    printUsage();
    throw new Error("bot_vault_id_or_all_required");
  }

  const service = createBotVaultTradingReconciliationService(prisma);
  const summary: Summary = {
    mode: botVaultId ? "single" : "batch",
    botVaultId: botVaultId ?? null,
    reportOnly,
    scanned: 0,
    processed: 0,
    failed: 0,
    newOrders: 0,
    newFills: 0,
    newFundingEvents: 0,
    reportReady: false,
    auditItems: 0
  };

  if (botVaultId) {
    const botVault = await prisma.botVault.findUnique({
      where: { id: botVaultId },
      select: { id: true, userId: true }
    });
    if (!botVault) throw new Error("bot_vault_not_found");

    if (!reportOnly) {
      const result = await service.reconcileBotVault({ botVaultId });
      summary.scanned = 1;
      summary.processed = 1;
      summary.newOrders = result.newOrders;
      summary.newFills = result.newFills;
      summary.newFundingEvents = result.newFundingEvents;
    }

    let report: unknown = null;
    let audit: unknown = null;

    try {
      report = await service.getBotVaultPnlReport({
        userId: String(botVault.userId),
        botVaultId,
        fillsLimit
      });
      summary.reportReady = true;
    } catch (error) {
      report = {
        error: error instanceof Error ? error.message : String(error)
      };
    }

    try {
      const auditResult = await service.getBotVaultAudit({
        userId: String(botVault.userId),
        botVaultId,
        limit: auditLimit
      });
      summary.auditItems = Array.isArray(auditResult.items) ? auditResult.items.length : 0;
      audit = auditResult;
    } catch (error) {
      audit = {
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          summary,
          report,
          audit
        },
        null,
        2
      )
    );
    return;
  }

  const batch = await service.reconcileHyperliquidBotVaults({ limit });
  summary.scanned = batch.scanned;
  summary.processed = batch.processed;
  summary.failed = batch.failed;
  summary.newOrders = batch.newOrders;
  summary.newFills = batch.newFills;
  summary.newFundingEvents = batch.newFundingEvents;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ summary }, null, 2));
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify(
        {
          fatal: true,
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
