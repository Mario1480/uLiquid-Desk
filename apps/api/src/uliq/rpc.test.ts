import assert from "node:assert/strict";
import test from "node:test";
import { getConsistentBlockAt, getConsistentFinalizedBlock, getConsistentSafeBlock } from "./rpc.js";

const HASH_100 = `0x${"10".repeat(32)}` as `0x${string}`;
const HASH_101 = `0x${"11".repeat(32)}` as `0x${string}`;
const OTHER_HASH = `0x${"ff".repeat(32)}` as `0x${string}`;

function block(number: bigint, hash: `0x${string}`) {
  return { number, hash, timestamp: 1_787_418_172n };
}

function pair(params: {
  primaryFinalized: bigint;
  secondaryFinalized: bigint;
  primarySafe?: bigint;
  secondarySafe?: bigint;
  secondaryHistoricalHash?: `0x${string}`;
}) {
  function hashFor(number: bigint) {
    return number === 100n ? HASH_100 : HASH_101;
  }
  const client = (source: "primary" | "secondary") => ({
    async getBlock(request: { blockTag?: "safe" | "finalized"; blockNumber?: bigint }) {
      if (request.blockNumber !== undefined) {
        const hash = source === "secondary" && params.secondaryHistoricalHash
          ? params.secondaryHistoricalHash
          : hashFor(request.blockNumber);
        return block(request.blockNumber, hash);
      }
      const number = request.blockTag === "safe"
        ? (source === "primary" ? params.primarySafe ?? params.primaryFinalized : params.secondarySafe ?? params.secondaryFinalized)
        : (source === "primary" ? params.primaryFinalized : params.secondaryFinalized);
      return block(number, hashFor(number));
    }
  });
  return { primary: client("primary"), secondary: client("secondary") } as any;
}

test("finalized RPC agreement accepts the same head", async () => {
  const result = await getConsistentFinalizedBlock(pair({ primaryFinalized: 100n, secondaryFinalized: 100n }));
  assert.equal(result.number, 100n);
  assert.equal(result.hash, HASH_100);
});

test("finalized RPC agreement uses the lower common finalized block when providers lag", async () => {
  const primaryAhead = await getConsistentFinalizedBlock(pair({ primaryFinalized: 101n, secondaryFinalized: 100n }));
  const secondaryAhead = await getConsistentFinalizedBlock(pair({ primaryFinalized: 100n, secondaryFinalized: 101n }));
  assert.equal(primaryAhead.number, 100n);
  assert.equal(primaryAhead.hash, HASH_100);
  assert.equal(secondaryAhead.number, 100n);
  assert.equal(secondaryAhead.hash, HASH_100);
});

test("safe RPC agreement follows the same lower common block policy", async () => {
  const result = await getConsistentSafeBlock(pair({
    primaryFinalized: 100n,
    secondaryFinalized: 100n,
    primarySafe: 101n,
    secondarySafe: 100n
  }));
  assert.equal(result.number, 100n);
  assert.equal(result.hash, HASH_100);
});

test("RPC agreement fails closed when providers disagree on the common block hash", async () => {
  await assert.rejects(
    () => getConsistentBlockAt(pair({
      primaryFinalized: 101n,
      secondaryFinalized: 100n,
      secondaryHistoricalHash: OTHER_HASH
    }), 100n),
    /uliq_rpc_block_mismatch/
  );
  await assert.rejects(
    () => getConsistentFinalizedBlock(pair({
      primaryFinalized: 101n,
      secondaryFinalized: 100n,
      secondaryHistoricalHash: OTHER_HASH
    })),
    /uliq_rpc_block_mismatch/
  );
});
