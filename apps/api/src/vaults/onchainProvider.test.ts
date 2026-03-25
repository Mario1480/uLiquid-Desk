import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, keccak256, pad, toHex } from "viem";
import { masterVaultAbi } from "./onchainAbi.js";
import { createOnchainProvider } from "./onchainProvider.js";

const addressBook = {
  chainId: 999,
  rpcUrl: "http://127.0.0.1:8545",
  factoryAddress: "0x00000000000000000000000000000000000000f1",
  usdcAddress: "0x00000000000000000000000000000000000000c1"
} as const;

test("buildCreateBotVaultTx hashes long ids so bytes32 encoding does not fail", async () => {
  const provider = createOnchainProvider(addressBook);
  const templateId = "legacy_grid_default";
  const botId = "cmn62inac003ynt2xe8eik0j5-very-long-bot-id";

  const tx = await provider.buildCreateBotVaultTx({
    masterVaultAddress: "0x0000000000000000000000000000000000000abc",
    templateId,
    botId,
    allocationAtomic: 111_240_000n
  });

  const decoded = decodeFunctionData({
    abi: masterVaultAbi,
    data: tx.data
  });

  assert.equal(decoded.functionName, "createBotVault");
  assert.deepEqual(decoded.args, [
    pad(toHex(templateId), { size: 32 }),
    keccak256(toHex(botId)),
    111_240_000n
  ]);
});

test("buildCreateBotVaultTx keeps short ids padded compatibly", async () => {
  const provider = createOnchainProvider(addressBook);

  const tx = await provider.buildCreateBotVaultTx({
    masterVaultAddress: "0x0000000000000000000000000000000000000abc",
    templateId: "futures_grid",
    botId: "bot_a",
    allocationAtomic: 200_000_000n
  });

  const decoded = decodeFunctionData({
    abi: masterVaultAbi,
    data: tx.data
  });

  assert.equal(decoded.functionName, "createBotVault");
  assert.deepEqual(decoded.args, [
    pad(toHex("futures_grid"), { size: 32 }),
    pad(toHex("bot_a"), { size: 32 }),
    200_000_000n
  ]);
});
