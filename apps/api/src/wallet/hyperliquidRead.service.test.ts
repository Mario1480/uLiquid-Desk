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
      limit: 6,
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
        }
      ]
    });

    assert.deepEqual(calls, ["userFillsByTime", "userNonFundingLedgerUpdates"]);
    const tracked = payload.items.find((item) => item.id === "act_1");
    assert.equal(tracked?.title, "Hyperliquid deposit");
    assert.equal(tracked?.status, "pending_reconciliation");
    assert.equal(tracked?.description, "Arbitrum -> Hyperliquid funding intent (10 USDC).");

    const ledger = payload.items.find((item) => item.id.startsWith("ledger_"));
    assert.equal(ledger?.title, "Spot -> Perp USDC transfer");
    assert.equal(ledger?.status, "confirmed");
    assert.equal(ledger?.size, 12.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
