import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, keccak256, pad, toHex } from "viem";
import { botVaultFactoryV4Abi, masterVaultAbi } from "./onchainAbi.js";
import { createOnchainProvider } from "./onchainProvider.js";

const addressBook = {
  contractVersion: "v1",
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

test("buildCreateBotVaultV3Tx encodes v4 locked split fee config", async () => {
  const provider = createOnchainProvider({
    ...addressBook,
    contractVersion: "v4"
  });

  const tx = await provider.buildCreateBotVaultV3Tx?.({
    beneficiaryAddress: "0x0000000000000000000000000000000000000bee",
    controllerAddress: "0x0000000000000000000000000000000000000dad",
    agentWallet: "0x0000000000000000000000000000000000000ace",
    templateId: "futures_grid",
    botId: "bot_aff",
    platformFeeRatePct: 5n,
    affiliateFeeRatePct: 10n,
    affiliateRecipientAddress: "0x0000000000000000000000000000000000000aff"
  });

  assert.ok(tx);
  const decoded = decodeFunctionData({
    abi: botVaultFactoryV4Abi,
    data: tx!.data
  });

  assert.equal(decoded.functionName, "createBotVault");
  assert.deepEqual([
    String(decoded.args[0]).toLowerCase(),
    String(decoded.args[1]).toLowerCase(),
    String(decoded.args[2]).toLowerCase(),
    decoded.args[3],
    decoded.args[4],
    decoded.args[5],
    decoded.args[6],
    String(decoded.args[7]).toLowerCase()
  ], [
    "0x0000000000000000000000000000000000000bee",
    "0x0000000000000000000000000000000000000dad",
    "0x0000000000000000000000000000000000000ace",
    pad(toHex("futures_grid"), { size: 32 }),
    pad(toHex("bot_aff"), { size: 32 }),
    5n,
    10n,
    "0x0000000000000000000000000000000000000aff"
  ]);
});
