import assert from "node:assert/strict";
import test from "node:test";
import {
  createUliqEntitlementSnapshotWithRaceRecovery,
  findCanonicalUliqEntitlementSnapshotAtBlock
} from "./entitlement.service.js";

const key = {
  userId: "user-1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  chainId: 421614,
  asOfBlock: 123n,
  blockHash: `0x${"12".repeat(32)}`
};

test("same-block entitlement lookup reuses the canonical immutable snapshot", async () => {
  const stored = { id: "snapshot-1", ...key };
  let where: Record<string, unknown> | null = null;
  const result = await findCanonicalUliqEntitlementSnapshotAtBlock({
    db: {
      uliqEntitlementSnapshot: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          where = args.where;
          return stored;
        }
      }
    },
    ...key
  });
  assert.equal(result, stored);
  assert.deepEqual(where, {
    userId: key.userId,
    walletAddress: key.walletAddress,
    chainId: key.chainId,
    asOfBlock: key.asOfBlock
  });
});

test("same-block entitlement lookup fails closed on a different canonical hash", async () => {
  await assert.rejects(
    () => findCanonicalUliqEntitlementSnapshotAtBlock({
      db: {
        uliqEntitlementSnapshot: {
          findFirst: async () => ({ ...key, blockHash: `0x${"34".repeat(32)}` })
        }
      },
      ...key
    }),
    /uliq_entitlement_snapshot_block_mismatch/
  );
});

test("parallel entitlement snapshot creation recovers the winner after P2002", async () => {
  const stored = { id: "snapshot-winner", ...key };
  const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" });
  const result = await createUliqEntitlementSnapshotWithRaceRecovery({
    db: {
      uliqEntitlementSnapshot: {
        create: async () => { throw duplicate; },
        findFirst: async () => stored
      }
    },
    data: key
  });
  assert.equal(result, stored);
});

test("entitlement snapshot creation does not mask unrelated database failures", async () => {
  const databaseError = Object.assign(new Error("database unavailable"), { code: "P1001" });
  await assert.rejects(
    () => createUliqEntitlementSnapshotWithRaceRecovery({
      db: {
        uliqEntitlementSnapshot: {
          create: async () => { throw databaseError; },
          findFirst: async () => null
        }
      },
      data: key
    }),
    (error) => error === databaseError
  );
});
