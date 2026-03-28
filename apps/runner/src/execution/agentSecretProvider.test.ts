import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createEncryptedEnvAgentSecretProvider, createEnvAgentSecretProvider } from "./agentSecretProvider.js";

function encryptSecret(plaintext: string, rawKey: string): string {
  const key = Buffer.from(rawKey, "utf8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

test("createEnvAgentSecretProvider resolves credentials by botVaultId", async () => {
  const provider = createEnvAgentSecretProvider(JSON.stringify({
    bv_1: {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      privateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }));

  const credentials = await provider.getAgentCredentials({
    botVaultId: "bv_1",
    agentWalletAddress: "0x1234567890ABCDEF1234567890ABCDEF12345678"
  });

  assert.equal(credentials?.address, "0x1234567890abcdef1234567890abcdef12345678");
  assert.equal(
    credentials?.privateKey,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
});

test("createEnvAgentSecretProvider resolves credentials by masterVaultId before botVault fallback", async () => {
  const provider = createEnvAgentSecretProvider(JSON.stringify({
    mv_1: {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      privateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    bv_1: {
      address: "0x9999999999999999999999999999999999999999",
      privateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  }));

  const credentials = await provider.getAgentCredentials({
    masterVaultId: "mv_1",
    botVaultId: "bv_1",
    agentWalletAddress: "0x1234567890abcdef1234567890abcdef12345678"
  });

  assert.equal(credentials?.address, "0x1234567890abcdef1234567890abcdef12345678");
  assert.equal(
    credentials?.privateKey,
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  );
});

test("createEnvAgentSecretProvider returns null for missing botVault secret", async () => {
  const provider = createEnvAgentSecretProvider("{}");
  const credentials = await provider.getAgentCredentials({
    botVaultId: "missing",
    agentWalletAddress: "0x1234567890abcdef1234567890abcdef12345678"
  });
  assert.equal(credentials, null);
});

test("createEnvAgentSecretProvider throws on agent wallet mismatch", async () => {
  const provider = createEnvAgentSecretProvider(JSON.stringify({
    bv_1: {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      privateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  }));

  await assert.rejects(
    provider.getAgentCredentials({
      botVaultId: "bv_1",
      agentWalletAddress: "0x9999999999999999999999999999999999999999"
    }),
    /agent_wallet_secret_mismatch/
  );
});

test("createEncryptedEnvAgentSecretProvider resolves versioned credentials and secretRef", async () => {
  const key = "12345678901234567890123456789012";
  process.env.AGENT_SECRET_ENCRYPTION_KEY = key;
  const ciphertext = encryptSecret(
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    key
  );
  const provider = createEncryptedEnvAgentSecretProvider(JSON.stringify({
    bv_2: [
      {
        version: 2,
        address: "0x2222222222222222222222222222222222222222",
        encryptedPrivateKey: ciphertext,
        secretRef: "vaults/bv_2/v2"
      }
    ]
  }));

  const credentials = await provider.getAgentCredentials({
    botVaultId: "bv_2",
    agentWalletAddress: "0x2222222222222222222222222222222222222222",
    agentWalletVersion: 2,
    agentSecretRef: "vaults/bv_2/v2"
  });

  assert.equal(credentials?.version, 2);
  assert.equal(credentials?.address, "0x2222222222222222222222222222222222222222");
  assert.equal(
    credentials?.privateKey,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );
});

test("createEncryptedEnvAgentSecretProvider resolves credentials by masterVaultId", async () => {
  const key = "12345678901234567890123456789012";
  process.env.AGENT_SECRET_ENCRYPTION_KEY = key;
  const ciphertext = encryptSecret(
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    key
  );
  const provider = createEncryptedEnvAgentSecretProvider(JSON.stringify({
    mv_2: {
      version: 3,
      address: "0x4444444444444444444444444444444444444444",
      encryptedPrivateKey: ciphertext,
      secretRef: "vaults/master/mv_2/v3"
    }
  }));

  const credentials = await provider.getAgentCredentials({
    masterVaultId: "mv_2",
    botVaultId: "bv_fallback",
    agentWalletAddress: "0x4444444444444444444444444444444444444444",
    agentWalletVersion: 3,
    agentSecretRef: "vaults/master/mv_2/v3"
  });

  assert.equal(credentials?.version, 3);
  assert.equal(credentials?.address, "0x4444444444444444444444444444444444444444");
});

test("createEncryptedEnvAgentSecretProvider sanitizes decrypt failures", async () => {
  process.env.AGENT_SECRET_ENCRYPTION_KEY = "12345678901234567890123456789012";
  const ciphertext = encryptSecret(
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "abcdefghijklmnopqrstuvwx12345678"
  );
  const provider = createEncryptedEnvAgentSecretProvider(JSON.stringify({
    bv_3: {
      version: 1,
      address: "0x3333333333333333333333333333333333333333",
      encryptedPrivateKey: ciphertext,
      secretRef: "vaults/bv_3/v1"
    }
  }));

  await assert.rejects(
    provider.getAgentCredentials({
      botVaultId: "bv_3",
      agentWalletAddress: "0x3333333333333333333333333333333333333333",
      agentWalletVersion: 1,
      agentSecretRef: "vaults/bv_3/v1"
    }),
    /agent_secret_invalid/
  );
});
