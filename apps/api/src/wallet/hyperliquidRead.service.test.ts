import assert from "node:assert/strict";
import test from "node:test";
import { createWalletReadService } from "./hyperliquidRead.service.js";

const ADDRESS = "0x1234567890123456789012345678901234567890";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("getWalletActivity includes Hyperliquid ledger events and tracked funding intents", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
    calls.push(String(body.type));
    if (body.type === "userFillsByTime") return jsonResponse([]);
    if (body.type === "userNonFundingLedgerUpdates") {
      return jsonResponse([
        {
          time: Date.parse("2026-05-09T10:00:00.000Z"),
          hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          delta: {
            type: "accountClassTransfer",
            usdc: "12.5",
            toPerp: true
          }
        }
      ]);
    }
    return jsonResponse([]);
  }) as typeof fetch;

  try {
    const service = createWalletReadService({
      hyperEvmChainId: 999,
      hyperEvmRpcUrl: "https://rpc.invalid",
      hyperEvmExplorerUrl: "https://explorer.invalid",
      hyperliquidInfoUrl: "https://hyperliquid.invalid/info",
      usdcAddress: null,
      usdcDecimals: 6,
      masterVaultAddress: null,
      errors: []
    });

    const payload = await service.getWalletActivity({
      address: ADDRESS,
      limit: 9,
      items: [
        {
          id: "act_1",
          actionType: "funding_bridge_deposit",
          status: "pending_reconciliation",
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: 42161,
          metadata: {
            amountFormatted: "10",
            asset: "USDC"
          },
          createdAt: "2026-05-09T11:00:00.000Z",
          updatedAt: "2026-05-09T11:01:00.000Z"
        },
        {
          id: "act_2",
          actionType: "funding_relay_usdc_to_arbitrum",
          status: "confirmed",
          txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          chainId: 999,
          metadata: {
            amountFormatted: "10",
            asset: "USDC"
          },
          createdAt: "2026-05-09T11:10:00.000Z",
          updatedAt: "2026-05-09T11:11:00.000Z"
        },
        {
          id: "act_3",
          actionType: "deposit_funding_vault",
          status: "confirmed",
          txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          chainId: 999,
          metadata: {
            amountUsd: 25
          },
          createdAt: "2026-05-09T11:20:00.000Z",
          updatedAt: "2026-05-09T11:21:00.000Z"
        },
        {
          id: "act_4",
          actionType: "withdraw_funding_vault",
          status: "confirmed",
          txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          chainId: 999,
          metadata: {
            amountUsd: 5
          },
          createdAt: "2026-05-09T11:30:00.000Z",
          updatedAt: "2026-05-09T11:31:00.000Z"
        },
        {
          id: "act_5",
          actionType: "fund_user_agent_wallet_hype",
          status: "submitted",
          txHash: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          chainId: 999,
          metadata: {
            amountFormatted: "0.02",
            asset: "HYPE"
          },
          createdAt: "2026-05-09T11:40:00.000Z",
          updatedAt: "2026-05-09T11:41:00.000Z"
        }
      ]
    });

    assert.deepEqual(calls, ["userFillsByTime", "userNonFundingLedgerUpdates"]);
    const tracked = payload.items.find((item) => item.id === "act_1");
    assert.equal(tracked?.title, "Hyperliquid deposit");
    assert.equal(tracked?.status, "pending_reconciliation");
    assert.equal(tracked?.description, "Arbitrum -> Hyperliquid funding intent (10 USDC).");

    const relayWithdrawal = payload.items.find((item) => item.id === "act_2");
    assert.equal(relayWithdrawal?.title, "User wallet withdrawal");
    assert.equal(relayWithdrawal?.status, "confirmed");
    assert.equal(relayWithdrawal?.description, "Relay HyperEVM -> Arbitrum USDC withdrawal intent (10 USDC).");

    const vaultDeposit = payload.items.find((item) => item.id === "act_3");
    assert.equal(vaultDeposit?.title, "Funding Vault deposit");
    assert.equal(vaultDeposit?.status, "confirmed");
    assert.equal(vaultDeposit?.description, "User wallet -> Funding Vault deposit (25 USDC).");
    assert.equal(vaultDeposit?.size, 25);

    const vaultWithdrawal = payload.items.find((item) => item.id === "act_4");
    assert.equal(vaultWithdrawal?.title, "Funding Vault withdrawal");
    assert.equal(vaultWithdrawal?.status, "confirmed");
    assert.equal(vaultWithdrawal?.description, "Funding Vault -> User wallet withdrawal (5 USDC).");
    assert.equal(vaultWithdrawal?.size, 5);

    const agentFunding = payload.items.find((item) => item.id === "act_5");
    assert.equal(agentFunding?.title, "Agent wallet funding");
    assert.equal(agentFunding?.status, "submitted");
    assert.equal(agentFunding?.description, "User wallet -> Agent wallet HYPE funding (0.02 HYPE).");
    assert.equal(agentFunding?.size, 0.02);

    const ledger = payload.items.find((item) => item.id.startsWith("ledger_"));
    assert.equal(ledger?.title, "Spot -> Perp USDC transfer");
    assert.equal(ledger?.status, "confirmed");
    assert.equal(ledger?.size, 12.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
