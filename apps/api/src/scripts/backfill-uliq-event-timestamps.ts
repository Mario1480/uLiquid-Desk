import { prisma } from "@mm/db";
import { getUliqRuntimeConfig } from "../uliq/config.js";
import { createUliqRpcPair } from "../uliq/rpc.js";

export async function backfillUliqEventTimestamps(db: any = prisma) {
  const config = getUliqRuntimeConfig();
  const rpc = createUliqRpcPair(config);
  const missingBlocks = await db.onchainIndexedEvent.findMany({
    where: { chainId: config.chainId, canonicalStatus: "FINALIZED", blockTimestamp: null },
    select: { blockNumber: true, blockHash: true },
    distinct: ["blockNumber"],
    orderBy: { blockNumber: "asc" }
  });
  let updated = 0;
  for (const row of missingBlocks) {
    const blockNumber = BigInt(row.blockNumber);
    const [primary, secondary] = await Promise.all([
      rpc.primary.getBlock({ blockNumber }),
      rpc.secondary.getBlock({ blockNumber })
    ]);
    if (!primary.hash || primary.hash !== secondary.hash) throw new Error(`uliq_rpc_block_mismatch_${blockNumber}`);
    if (row.blockHash && String(row.blockHash).toLowerCase() !== primary.hash.toLowerCase()) {
      throw new Error(`uliq_event_block_hash_mismatch_${blockNumber}`);
    }
    const result = await db.onchainIndexedEvent.updateMany({
      where: {
        chainId: config.chainId,
        canonicalStatus: "FINALIZED",
        blockNumber,
        blockHash: primary.hash,
        blockTimestamp: null
      },
      data: { blockTimestamp: new Date(Number(primary.timestamp) * 1_000) }
    });
    updated += result.count;
  }
  return { scannedBlocks: missingBlocks.length, updatedEvents: updated };
}

if (process.argv[1]?.includes("backfill-uliq-event-timestamps")) {
  backfillUliqEventTimestamps()
    .then((result) => console.log(JSON.stringify(result)))
    .finally(() => prisma.$disconnect());
}
