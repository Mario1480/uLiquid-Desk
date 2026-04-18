import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBotVaultFactoryAddress,
  resolveHyperEvmWriteRpcUrl
} from "./onchainAddressBook.js";

test("resolveHyperEvmWriteRpcUrl prefers dedicated controller rpc", () => {
  const previous = {
    HYPEREVM_CONTROLLER_RPC_URL: process.env.HYPEREVM_CONTROLLER_RPC_URL,
    HYPEREVM_RPC_URL_FALLBACK: process.env.HYPEREVM_RPC_URL_FALLBACK
  };

  process.env.HYPEREVM_CONTROLLER_RPC_URL = "https://controller.example";
  process.env.HYPEREVM_RPC_URL_FALLBACK = "https://fallback.example";

  try {
    assert.equal(resolveHyperEvmWriteRpcUrl("https://read.example"), "https://controller.example");
  } finally {
    process.env.HYPEREVM_CONTROLLER_RPC_URL = previous.HYPEREVM_CONTROLLER_RPC_URL;
    process.env.HYPEREVM_RPC_URL_FALLBACK = previous.HYPEREVM_RPC_URL_FALLBACK;
  }
});

test("resolveHyperEvmWriteRpcUrl prefers explicit read rpc before fallback rpc", () => {
  const previous = {
    HYPEREVM_CONTROLLER_RPC_URL: process.env.HYPEREVM_CONTROLLER_RPC_URL,
    HYPEREVM_RPC_URL_FALLBACK: process.env.HYPEREVM_RPC_URL_FALLBACK
  };

  delete process.env.HYPEREVM_CONTROLLER_RPC_URL;
  process.env.HYPEREVM_RPC_URL_FALLBACK = "https://fallback.example";

  try {
    assert.equal(resolveHyperEvmWriteRpcUrl("https://read.example"), "https://read.example");
    delete process.env.HYPEREVM_RPC_URL_FALLBACK;
    assert.equal(resolveHyperEvmWriteRpcUrl("https://read.example"), "https://read.example");
  } finally {
    process.env.HYPEREVM_CONTROLLER_RPC_URL = previous.HYPEREVM_CONTROLLER_RPC_URL;
    process.env.HYPEREVM_RPC_URL_FALLBACK = previous.HYPEREVM_RPC_URL_FALLBACK;
  }
});

test("resolveHyperEvmWriteRpcUrl uses default write rpc when nothing else is configured", () => {
  const previous = {
    HYPEREVM_CONTROLLER_RPC_URL: process.env.HYPEREVM_CONTROLLER_RPC_URL,
    HYPEREVM_RPC_URL_FALLBACK: process.env.HYPEREVM_RPC_URL_FALLBACK
  };

  delete process.env.HYPEREVM_CONTROLLER_RPC_URL;
  delete process.env.HYPEREVM_RPC_URL_FALLBACK;

  try {
    assert.equal(resolveHyperEvmWriteRpcUrl(null), "https://rpc.hypurrscan.io");
  } finally {
    process.env.HYPEREVM_CONTROLLER_RPC_URL = previous.HYPEREVM_CONTROLLER_RPC_URL;
    process.env.HYPEREVM_RPC_URL_FALLBACK = previous.HYPEREVM_RPC_URL_FALLBACK;
  }
});

test("resolveBotVaultFactoryAddress resolves dedicated v4 factory envs", () => {
  const previous = {
    BOT_VAULT_V3_FACTORY_ADDRESS: process.env.BOT_VAULT_V3_FACTORY_ADDRESS,
    BOT_VAULT_V4_FACTORY_ADDRESS: process.env.BOT_VAULT_V4_FACTORY_ADDRESS,
    BOT_VAULT_V4_SIM_FACTORY_ADDRESS: process.env.BOT_VAULT_V4_SIM_FACTORY_ADDRESS
  };

  process.env.BOT_VAULT_V3_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000a3";
  process.env.BOT_VAULT_V4_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000a4";
  process.env.BOT_VAULT_V4_SIM_FACTORY_ADDRESS = "0x00000000000000000000000000000000000000b4";

  try {
    assert.equal(
      resolveBotVaultFactoryAddress("onchain_live", "v4"),
      "0x00000000000000000000000000000000000000a4"
    );
    assert.equal(
      resolveBotVaultFactoryAddress("onchain_sim", "v4"),
      "0x00000000000000000000000000000000000000b4"
    );
    assert.equal(
      resolveBotVaultFactoryAddress("onchain_live", "v3"),
      "0x00000000000000000000000000000000000000a3"
    );
  } finally {
    process.env.BOT_VAULT_V3_FACTORY_ADDRESS = previous.BOT_VAULT_V3_FACTORY_ADDRESS;
    process.env.BOT_VAULT_V4_FACTORY_ADDRESS = previous.BOT_VAULT_V4_FACTORY_ADDRESS;
    process.env.BOT_VAULT_V4_SIM_FACTORY_ADDRESS = previous.BOT_VAULT_V4_SIM_FACTORY_ADDRESS;
  }
});
