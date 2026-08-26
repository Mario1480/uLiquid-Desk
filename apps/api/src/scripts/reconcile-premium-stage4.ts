import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@mm/db";
import { runStage4Reconciliation } from "../billing/stage4Reconciliation.js";

const APPLY_CONFIRMATION = "APPLY_PREMIUM_STAGE4";

function readArg(name: string): string | undefined {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  const next = index >= 0 ? process.argv[index + 1] : undefined;
  return next && !next.startsWith("--") ? next.trim() : undefined;
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log([
    "Usage:",
    "  npm -w apps/api run reconcile:premium-stage4 -- --dry-run [--report ./stage4-report.json]",
    `  PREMIUM_STAGE4_COMPATIBLE_CODE_DEPLOYED=true npm -w apps/api run reconcile:premium-stage4 -- --apply --confirm ${APPLY_CONFIRMATION} [--report ./stage4-report.json]`,
    "",
    "Dry-run is the default. Apply requires both the compatible-deployment environment gate and exact confirmation."
  ].join("\n"));
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }
  const apply = process.argv.includes("--apply");
  if (apply) {
    if (process.env.PREMIUM_STAGE4_COMPATIBLE_CODE_DEPLOYED !== "true") {
      throw new Error("stage4_compatible_deployment_not_confirmed");
    }
    if (readArg("--confirm") !== APPLY_CONFIRMATION) {
      throw new Error("stage4_apply_confirmation_invalid");
    }
  }

  const report = await runStage4Reconciliation({
    database: prisma as any,
    apply,
    pageSize: Number(readArg("--page-size") ?? 250)
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = readArg("--report");
  if (reportPath) await writeFile(resolve(reportPath), output, { encoding: "utf8", flag: "wx" });
  // eslint-disable-next-line no-console
  console.log(output.trimEnd());

  if (apply && report.reviews.length > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error({
      error: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
