import assert from "node:assert/strict";
import test from "node:test";
import { UliqPublicPresaleSessionService } from "./publicPresaleSession.service.js";

const WALLET = "0x1111111111111111111111111111111111111111";

function createState() {
  const sessions: any[] = [];
  const acknowledgements: any[] = [];
  const db = {
    uliqPresaleSession: {
      create: async ({ data }: any) => {
        const row = { id: `session-${sessions.length + 1}`, ...data, revokedAt: null };
        sessions.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => sessions.find((row) => row.tokenHash === where.tokenHash) ?? null,
      update: async ({ where, data }: any) => {
        const row = sessions.find((candidate) => candidate.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = sessions.filter((row) => row.tokenHash === where.tokenHash && row.revokedAt === where.revokedAt);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }
    },
    uliqPresaleLegalAcknowledgement: {
      findUnique: async ({ where }: any) => acknowledgements.find((row) => {
        const key = where.walletAddress_chainId_version_textHash;
        return row.walletAddress === key.walletAddress && row.chainId === key.chainId && row.version === key.version && row.textHash === key.textHash;
      }) ?? null,
      upsert: async ({ create }: any) => {
        const existing = acknowledgements.find((row) => row.walletAddress === create.walletAddress && row.chainId === create.chainId && row.version === create.version && row.textHash === create.textHash);
        if (existing) return existing;
        const row = { id: `ack-${acknowledgements.length + 1}`, acceptedAt: new Date(), ...create };
        acknowledgements.push(row);
        return row;
      }
    }
  };
  return { db, sessions, acknowledgements };
}

test("public presale sessions are opaque, wallet-bound, and revocable", async () => {
  const state = createState();
  const service = new UliqPublicPresaleSessionService(state.db);
  const created = await service.create({ walletAddress: WALLET, chainId: 421614, ipAddress: " 127.0.0.1 ", userAgent: "test\u0000agent" });

  assert.equal(created.token.length, 64);
  assert.notEqual(state.sessions[0].tokenHash, created.token);
  assert.equal(created.session.walletAddress, WALLET);
  assert.equal((await service.resolve(created.token))?.id, created.session.id);

  await service.revoke(created.token);
  assert.equal(await service.resolve(created.token), null);
});

test("terms acceptance is versioned by wallet, chain, and text hash", async () => {
  const state = createState();
  const service = new UliqPublicPresaleSessionService(state.db);
  const created = await service.create({ walletAddress: WALLET, chainId: 42161 });
  const terms = { version: "approved-v1", textHash: "ab".repeat(32) };

  assert.equal(await service.getTermsAcceptance(created.session, terms), null);
  await service.acceptTerms({ session: created.session, ...terms, userAgent: "browser" });
  assert.ok(await service.getTermsAcceptance(created.session, terms));
  assert.equal(await service.getTermsAcceptance(created.session, { ...terms, textHash: "cd".repeat(32) }), null);
});
