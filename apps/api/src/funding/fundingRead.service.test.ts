import assert from "node:assert/strict";
import test from "node:test";
import { createFundingReadService } from "./fundingRead.service.js";

const ADDRESS = "0x1234567890123456789012345678901234567890";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("getFundingHistory merges Hyperliquid ledger events and keeps tracked intents on duplicate tx hashes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}"));
    if (body.type !== "userNonFundingLedgerUpdates") return jsonResponse([]);
    return jsonResponse([
      {
        time: Date.parse("2026-05-09T10:00:00.000Z"),
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        delta: {
          type: "deposit",
          usdc: "25"
        }
      },
      {
        time: Date.parse("2026-05-09T09:00:00.000Z"),
        hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        delta: {
          type: "accountClassTransfer",
          usdc: "5",
          toPerp: false
        }
      }
    ]);
  }) as typeof fetch;

  try {
    const service = createFundingReadService({
      arbitrum: {
        chainId: 42161,
        rpcUrl: "https://arbitrum.invalid",
        explorerUrl: "https://arbiscan.invalid",
        usdcAddress: null,
        usdcDecimals: 6
      },
      hyperEvm: {
        chainId: 999,
        rpcUrl: "https://hyperevm.invalid",
        explorerUrl: "https://explorer.invalid",
        usdcAddress: null,
        usdcDecimals: 6
      },
      hyperliquidInfoUrl: "https://hyperliquid.invalid/info",
      masterVault: {
        address: null
      },
      externalLinks: {
        depositUrl: "https://app.hyperliquid.invalid/deposit",
        bridgeUrl: "https://app.hyperliquid.invalid/portfolio",
        coreTransferUrl: "https://app.hyperliquid.invalid/portfolio"
      },
      hyperliquidExchangeUrl: "https://hyperliquid.invalid",
      bridge: {
        depositContractAddress: null,
        minDepositUsdc: 5,
        withdrawFeeUsdc: 1
      },
      errors: []
    });

    const payload = await service.getFundingHistory({
      address: ADDRESS,
      items: [
        {
          id: "act_1",
          actionType: "funding_bridge_deposit",
          status: "submitted",
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: 42161,
          metadata: {
            amountFormatted: "25",
            asset: "USDC",
            direction: "arbitrum_to_hypercore"
          },
          createdAt: "2026-05-09T10:00:00.000Z",
          updatedAt: "2026-05-09T10:01:00.000Z"
        }
      ]
    });

    const duplicateTxItems = payload.items.filter(
      (item) => item.txHash === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    assert.equal(duplicateTxItems.length, 1);
    assert.equal(duplicateTxItems[0]?.id, "act_1");
    assert.equal(duplicateTxItems[0]?.status, "submitted");

    const accountClassTransfer = payload.items.find(
      (item) => item.txHash === "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
    assert.equal(accountClassTransfer?.actionId, "transfer_usdc_perp_to_spot");
    assert.equal(accountClassTransfer?.title, "Perp -> Spot USDC transfer");
    assert.equal(accountClassTransfer?.status, "confirmed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
