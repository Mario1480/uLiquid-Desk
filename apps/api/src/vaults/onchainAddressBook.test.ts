import assert from "node:assert/strict";
import test from "node:test";
import { resolveHyperEvmWriteRpcUrl } from "./onchainAddressBook.js";

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
