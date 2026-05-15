import assert from "node:assert/strict";
import test from "node:test";
import { createRelayFundingService } from "./relayFunding.service.js";

const CONFIG = {
  arbitrum: {
    chainId: 42161,
    rpcUrl: "https://arb.invalid",
    explorerUrl: "https://arbiscan.invalid",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as `0x${string}`,
    usdcDecimals: 6
  },
  hyperEvm: {
    chainId: 999,
    rpcUrl: "https://hyperevm.invalid",
    explorerUrl: "https://hyperevm.invalid/explorer",
    usdcAddress: "0xb88339CB7199b77E23DB6E890353E22632Ba630f" as `0x${string}`,
    usdcDecimals: 6
  },
  hyperliquidInfoUrl: "https://hyperliquid.invalid/info",
  masterVault: { address: null },
  externalLinks: { depositUrl: null, bridgeUrl: null, coreTransferUrl: null },
  hyperliquidExchangeUrl: "https://hyperliquid.invalid",
  bridge: { depositContractAddress: null, minDepositUsdc: 5, withdrawFeeUsdc: 1 },
  errors: []
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function quotePayload(
  requestId: string,
  destinationAddress: string,
  symbol: "USDC" | "HYPE",
  chains = { origin: CONFIG.arbitrum.chainId, destination: CONFIG.hyperEvm.chainId }
) {
  return {
    details: {
      timeEstimate: 2,
      currencyIn: {
        currency: {
          chainId: chains.origin,
          address: chains.origin === CONFIG.hyperEvm.chainId ? CONFIG.hyperEvm.usdcAddress : CONFIG.arbitrum.usdcAddress,
          symbol: "USDC",
          decimals: 6
        },
        amount: "10000000",
        amountFormatted: "10"
      },
      currencyOut: {
        currency: {
          chainId: chains.destination,
          address: destinationAddress,
          symbol,
          decimals: symbol === "USDC" ? 6 : 18
        },
        amount: symbol === "USDC" ? "9990000" : "100000000000000000",
        amountFormatted: symbol === "USDC" ? "9.99" : "0.1"
      }
    },
    fees: {
      relayer: {
        currency: { chainId: 42161, symbol: "USDC", decimals: 6 },
        amount: "10000",
        amountFormatted: "0.01"
      },
      gas: {
        currency: { chainId: 42161, symbol: "ETH", decimals: 18 },
        amount: "1000",
        amountFormatted: "0.000000000000001"
      }
    },
    steps: [
      {
        id: "deposit",
        kind: "transaction",
        items: [
          {
            status: "incomplete",
            data: {
              chainId: 42161,
              to: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
              value: "0",
              data: "0xabcdef"
            },
            check: `/intents/status/v3?requestId=${requestId}`
          }
        ]
      }
    ]
  };
}

test("Relay funding service normalizes USDC and HYPE top-up quotes", async () => {
  const calls: any[] = [];
  const service = createRelayFundingService({
    config: CONFIG,
    fetch: (async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body ?? "{}"));
      calls.push(body);
      if (body.destinationCurrency === "0x0000000000000000000000000000000000000000") {
        return jsonResponse(quotePayload(
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "0x0000000000000000000000000000000000000000",
          "HYPE"
        ));
      }
      return jsonResponse(quotePayload(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        CONFIG.hyperEvm.usdcAddress,
        "USDC"
      ));
    }) as typeof fetch
  });

  const quote = await service.getQuote({
    user: "0x1234567890123456789012345678901234567890",
    usdcAmount: "10",
    includeHypeTopup: true,
    hypeTopupUsdcAmount: "5"
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.originChainId, CONFIG.arbitrum.chainId);
  assert.equal(calls[0]?.destinationChainId, CONFIG.hyperEvm.chainId);
  assert.equal(quote.direction, "arbitrum_to_hyperevm");
  assert.equal(quote.usdc.asset, "USDC");
  assert.equal(quote.usdc.requestId, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(quote.hypeTopup?.asset, "HYPE");
  assert.equal(quote.hypeTopup?.requestId, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(quote.usdc.steps[0]?.items[0]?.tx.chainId, 42161);
});

test("Relay funding service builds HyperEVM to Arbitrum USDC quotes", async () => {
  const calls: any[] = [];
  const service = createRelayFundingService({
    config: CONFIG,
    fetch: (async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body ?? "{}"));
      calls.push(body);
      return jsonResponse(quotePayload(
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        CONFIG.arbitrum.usdcAddress,
        "USDC",
        { origin: CONFIG.hyperEvm.chainId, destination: CONFIG.arbitrum.chainId }
      ));
    }) as typeof fetch
  });

  const quote = await service.getQuote({
    user: "0x1234567890123456789012345678901234567890",
    direction: "hyperevm_to_arbitrum",
    usdcAmount: "10",
    includeHypeTopup: false
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.originChainId, CONFIG.hyperEvm.chainId);
  assert.equal(calls[0]?.destinationChainId, CONFIG.arbitrum.chainId);
  assert.equal(calls[0]?.originCurrency, CONFIG.hyperEvm.usdcAddress);
  assert.equal(calls[0]?.destinationCurrency, CONFIG.arbitrum.usdcAddress);
  assert.equal(calls[0]?.recipient, "0x1234567890123456789012345678901234567890");
  assert.equal(quote.direction, "hyperevm_to_arbitrum");
  assert.equal(quote.usdc.legId, "usdc_withdrawal");
  assert.equal(quote.hypeTopup, null);
});

test("Relay funding service rejects HYPE top-up for HyperEVM to Arbitrum quotes", async () => {
  const service = createRelayFundingService({
    config: CONFIG,
    fetch: (async () => jsonResponse({})) as typeof fetch
  });

  await assert.rejects(
    service.getQuote({
      user: "0x1234567890123456789012345678901234567890",
      direction: "hyperevm_to_arbitrum",
      usdcAmount: "10",
      includeHypeTopup: true,
      hypeTopupUsdcAmount: "5"
    }),
    /relay_hype_topup_not_supported/
  );
});

test("Relay funding service validates quote amounts and request ids", async () => {
  const service = createRelayFundingService({
    config: CONFIG,
    fetch: (async () => jsonResponse({})) as typeof fetch
  });

  await assert.rejects(
    service.getQuote({
      user: "0x1234567890123456789012345678901234567890",
      usdcAmount: "0",
      includeHypeTopup: false
    }),
    /relay_invalid_amount/
  );

  await assert.rejects(
    service.getStatus({ requestId: "bad" }),
    /relay_invalid_request_id/
  );
});

test("Relay funding service normalizes status responses", async () => {
  const service = createRelayFundingService({
    config: CONFIG,
    fetch: (async () => jsonResponse({
      status: "success",
      destinationTxHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    })) as typeof fetch
  });

  const status = await service.getStatus({
    requestId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  });

  assert.equal(status.status, "success");
  assert.equal(status.txHash, "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
});
