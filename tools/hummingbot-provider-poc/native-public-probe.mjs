import process from "node:process";
import { BitgetMarketApi } from "../../packages/futures-exchange/dist/bitget/bitget.market.api.js";
import { BitgetRestClient } from "../../packages/futures-exchange/dist/bitget/bitget.rest.js";
import {
  normalizeProviderOrderBook,
  redactProviderDiagnostics
} from "../../packages/futures-exchange/dist/core/provider-contracts.js";

function row(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === "object" ? value : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findNumber(value, keys) {
  const item = row(value);
  for (const key of keys) {
    const parsed = number(item?.[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function rejectCredentialEnvironment() {
  const forbidden = ["BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"];
  const present = forbidden.filter((key) => String(process.env[key] ?? "").trim());
  if (present.length > 0) throw new Error(`poc_credentials_forbidden:${present.join(",")}`);
}

const options = JSON.parse(process.argv[2] ?? "{}");
const symbol = String(options.symbol ?? "BTCUSDT").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const samples = Math.max(1, Math.min(10, Math.trunc(Number(options.samples ?? 3))));
const depth = Math.max(1, Math.min(50, Math.trunc(Number(options.depth ?? 25))));
const timeoutMs = Math.max(100, Math.min(10_000, Math.trunc(Number(options.timeoutMs ?? 10_000))));

rejectCredentialEnvironment();
if (process.env.ULIQ_HB_POC_ENABLED !== "true") throw new Error("poc_disabled");

const requestLog = [];
const initialCpu = process.cpuUsage();
const rest = new BitgetRestClient({
  timeoutMs,
  retryAttempts: 2,
  retryBaseDelayMs: 100,
  log: (entry) => requestLog.push(entry)
});
const market = new BitgetMarketApi(rest);
const output = {
  schemaVersion: "1.0.0",
  providerId: "uliquid-native:bitget",
  status: "observed",
  venue: "bitget",
  marketType: "perpetual",
  productType: "USDT-FUTURES",
  symbol,
  samples: [],
  requestAttempts: 0,
  limitations: ["public_read_only", "observations_are_not_atomic"]
};

for (let sequence = 1; sequence <= samples; sequence += 1) {
  const startedAt = Date.now();
  try {
    const [tickerRaw, depthRaw, candlesRaw, fundingRaw, openInterestRaw, contractsRaw] = await Promise.all([
      market.getTicker(symbol),
      market.getDepth(symbol, depth),
      market.getCandles({ symbol, granularity: "1m", limit: 2 }),
      market.getFundingRate(symbol),
      market.getOpenInterest(symbol),
      market.getContracts()
    ]);
    const ticker = row(tickerRaw);
    const book = depthRaw && typeof depthRaw === "object" ? depthRaw : {};
    const funding = row(fundingRaw);
    const interestEnvelope = row(openInterestRaw);
    const interest = row(interestEnvelope?.openInterestList);
    const contract = Array.isArray(contractsRaw)
      ? contractsRaw.find((candidate) => String(candidate?.symbol ?? "").toUpperCase() === symbol)
      : null;
    output.samples.push({
      sequence,
      fetchedAtMs: Date.now(),
      durationMs: Date.now() - startedAt,
      providerTimestampMs: findNumber(book, ["ts", "timestamp"])
        ?? findNumber(interestEnvelope, ["ts", "timestamp"])
        ?? findNumber(ticker, ["ts", "timestamp"]),
      ticker: {
        last: findNumber(ticker, ["lastPr", "last", "lastPrice"]),
        bid: findNumber(ticker, ["bidPr", "bidPrice"]),
        ask: findNumber(ticker, ["askPr", "askPrice"]),
        mark: findNumber(ticker, ["markPrice", "indexPrice"])
      },
      orderbook: normalizeProviderOrderBook({
        bids: book.bids,
        asks: book.asks,
        quantityUnit: "base_asset",
        depth
      }),
      candles: Array.isArray(candlesRaw) ? candlesRaw.length : 0,
      funding: {
        rate: findNumber(funding, ["fundingRate"]),
        intervalHours: findNumber(funding, ["fundingRateInterval", "fundingIntervalHours"]),
        markPrice: findNumber(ticker, ["markPrice"])
      },
      openInterest: {
        value: findNumber(interest, ["size"]),
        unit: "base_asset"
      },
      tradingRules: contract ? {
        tickSize: number(contract.priceEndStep) && number(contract.pricePlace) !== null
          ? number(contract.priceEndStep) * (10 ** -number(contract.pricePlace))
          : null,
        stepSize: number(contract.sizeMultiplier),
        minQuantity: number(contract.minTradeNum),
        minNotional: null
      } : null
    });
  } catch (error) {
    output.status = "degraded";
    output.samples.push({
      sequence,
      fetchedAtMs: Date.now(),
      durationMs: Date.now() - startedAt,
      error: redactProviderDiagnostics(String(error))
    });
  }
}
output.requestAttempts = requestLog.length;
output.resourceUsage = {
  cpuMicros: Object.values(process.cpuUsage(initialCpu)).reduce((sum, value) => sum + value, 0),
  rssBytes: process.memoryUsage().rss
};
process.stdout.write(`${JSON.stringify(output)}\n`);
