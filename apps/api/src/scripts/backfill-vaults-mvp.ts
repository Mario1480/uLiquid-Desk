import "dotenv/config";
import { prisma } from "@mm/db";
import { createVaultService } from "../vaults/service.js";

type Summary = {
  dryRun: boolean;
  usersScanned: number;
  usersFailed: number;
  masterVaultCreated: number;
  botVaultCreated: number;
  botVaultSkippedExisting: number;
  pendingFillEventsProcessed: number;
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

function parseLimit(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm -w apps/api run backfill:vaults-mvp -- [--dry-run] [--user-id <id>] [--limit <n>] [--include-archived-grid] [--process-pending-fills] [--fill-batch-limit <n>]",
      "",
      "Examples:",
      "  npm -w apps/api run backfill:vaults-mvp -- --dry-run",
      "  npm -w apps/api run backfill:vaults-mvp -- --user-id user_123",
      "  npm -w apps/api run backfill:vaults-mvp -- --process-pending-fills --fill-batch-limit 300"
    ].join("\n")
  );
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    printUsage();
    return;
  }

  const dryRun = hasFlag("--dry-run");
  const includeArchivedGrid = hasFlag("--include-archived-grid");
  const processPendingFills = hasFlag("--process-pending-fills");
  const userIdFilter = readArg("--user-id");
  const limit = parseLimit(readArg("--limit"));
  const fillBatchLimit = parseLimit(readArg("--fill-batch-limit")) ?? 200;

  const summary: Summary = {
    dryRun,
    usersScanned: 0,
    usersFailed: 0,
    masterVaultCreated: 0,
    botVaultCreated: 0,
    botVaultSkippedExisting: 0,
    pendingFillEventsProcessed: 0
  };

  const vaultService = createVaultService(prisma);
  const users = userIdFilter
    ? await prisma.user.findMany({
        where: { id: userIdFilter },
        select: { id: true },
        take: 1
      })
    : await prisma.user.findMany({
        select: { id: true },
        orderBy: { createdAt: "asc" },
        ...(limit ? { take: limit } : {})
      });

  summary.usersScanned = users.length;
  if (users.length === 0) {
    // eslint-disable-next-line no-console
    console.log("[backfill-vaults-mvp] no_users", { userIdFilter: userIdFilter ?? null });
    return;
  }

  for (const user of users) {
    const userId = String(user.id);
    try {
      const existingMaster = await prisma.masterVault.findUnique({
        where: { userId },
        select: { id: true }
      });
      if (!existingMaster) summary.masterVaultCreated += 1;

      if (!dryRun) {
        await vaultService.ensureMasterVault({ userId });
      }

      const gridInstances = await prisma.gridBotInstance.findMany({
        where: {
          userId,
          ...(includeArchivedGrid ? {} : { archivedAt: null })
        },
        select: {
          id: true,
          investUsd: true,
          extraMarginUsd: true,
          botVault: {
            select: { id: true }
          }
        },
        orderBy: { createdAt: "asc" }
      });

      for (const gridInstance of gridInstances) {
        const allocationUsd = Number(gridInstance.investUsd ?? 0) + Number(gridInstance.extraMarginUsd ?? 0);
        if (gridInstance.botVault?.id) {
          summary.botVaultSkippedExisting += 1;
          continue;
        }
        summary.botVaultCreated += 1;
        if (!dryRun) {
          await vaultService.ensureBotVaultForGridInstance({
            userId,
            gridInstanceId: String(gridInstance.id),
            allocatedUsd: allocationUsd
          });
        }
      }

      // eslint-disable-next-line no-console
      console.log("[backfill-vaults-mvp] user_done", {
        userId,
        masterVaultExisted: Boolean(existingMaster),
        gridInstances: gridInstances.length
      });
    } catch (error) {
      summary.usersFailed += 1;
      // eslint-disable-next-line no-console
      console.error("[backfill-vaults-mvp] user_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (processPendingFills && !dryRun) {
    const accounting = await vaultService.processPendingGridFillEvents({
      limit: fillBatchLimit
    });
    summary.pendingFillEventsProcessed = accounting.processed;
  }

  // eslint-disable-next-line no-console
  console.log("[backfill-vaults-mvp] summary", summary);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-vaults-mvp] fatal", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
