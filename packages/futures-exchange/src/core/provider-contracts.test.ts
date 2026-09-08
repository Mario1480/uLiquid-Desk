import assert from "node:assert/strict";
import test from "node:test";
import { BITGET_FUTURES_CAPABILITIES } from "./exchange-capabilities.js";
import {
  ProviderContractError,
  assertProviderAccountBinding,
  assertProviderCapability,
  canonicalExecutionIdentity,
  deriveProviderHealth,
  normalizeProviderOrderBook,
  normalizeProviderTimestamp,
  redactProviderDiagnostics,
  runBoundedProviderRead,
  type CapabilityDescriptor,
  type ExecutionIntent
} from "./provider-contracts.js";

const capability: CapabilityDescriptor = {
  schemaVersion: "1.0.0",
  providerId: "hummingbot-poc:bitget-perpetual",
  providerKind: "hummingbot_poc",
  venue: "bitget",
  marketTypes: ["perpetual"],
  marketData: { ...BITGET_FUTURES_CAPABILITIES.marketData, candles: "unsupported" },
  execution: {
    supported: false,
    enabledByDefault: false,
    orderTypes: [],
    positionModes: [],
    marginModes: [],
    reduceOnly: false
  },
  liveCertificationStatus: "not_assessed"
};

test("POC capabilities fail closed and never imply execution or certification", () => {
  assert.doesNotThrow(() => assertProviderCapability(capability, "ticker"));
  assert.throws(
    () => assertProviderCapability(capability, "candles"),
    (error) => error instanceof ProviderContractError && error.code === "provider_capability_unsupported"
  );
  assert.throws(
    () => assertProviderCapability({ ...capability, marketData: { ...capability.marketData, ticker: undefined } } as unknown as CapabilityDescriptor, "ticker"),
    (error) => error instanceof ProviderContractError && error.code === "provider_capability_unsupported"
  );
  assert.equal(capability.execution.enabledByDefault, false);
  assert.equal(capability.liveCertificationStatus, "not_assessed");
});

test("order books reject malformed, empty and crossed observations", () => {
  assert.throws(
    () => normalizeProviderOrderBook({ bids: "bad", asks: [], quantityUnit: "base_asset", depth: 10 }),
    (error) => error instanceof ProviderContractError && error.code === "provider_orderbook_malformed"
  );
  assert.throws(
    () => normalizeProviderOrderBook({ bids: [], asks: [], quantityUnit: "base_asset", depth: 10 }),
    (error) => error instanceof ProviderContractError && error.code === "provider_orderbook_empty"
  );
  assert.throws(
    () => normalizeProviderOrderBook({ bids: [[101, 1]], asks: [[100, 1]], quantityUnit: "base_asset", depth: 10 }),
    (error) => error instanceof ProviderContractError && error.code === "provider_orderbook_crossed"
  );
});

test("contract quantities normalize to base units and invalid units fail", () => {
  const book = normalizeProviderOrderBook({
    bids: [[100, 2], [99, 1]],
    asks: [[102, 3], [101, 4]],
    quantityUnit: "contracts",
    contractSize: 0.01,
    depth: 1
  });
  assert.deepEqual(book, { bids: [[100, 0.02]], asks: [[102, 0.03]], quantityUnit: "base_asset" });
  assert.throws(
    () => normalizeProviderOrderBook({ bids: [[100, 2]], asks: [[101, 2]], quantityUnit: "contracts", depth: 1 }),
    (error) => error instanceof ProviderContractError && error.code === "provider_contract_size_invalid"
  );
});

test("missing, future and stale timestamps remain explicit", () => {
  const fetchedAtMs = Date.parse("2026-09-08T12:00:00.000Z");
  assert.deepEqual(normalizeProviderTimestamp({ value: null, fetchedAtMs, staleAfterMs: 5_000 }), {
    observedAt: null,
    fetchedAt: "2026-09-08T12:00:00.000Z",
    quality: "degraded",
    warnings: ["provider_timestamp_missing"]
  });
  assert.equal(normalizeProviderTimestamp({ value: fetchedAtMs + 6_000, fetchedAtMs, staleAfterMs: 5_000 }).quality, "degraded");
  assert.equal(normalizeProviderTimestamp({ value: fetchedAtMs - 6_000, fetchedAtMs, staleAfterMs: 5_000 }).quality, "stale");
});

test("provider health distinguishes disabled, unavailable, stale and degraded states", () => {
  const base = {
    providerId: "provider_1",
    enabled: true,
    checkedAtMs: Date.parse("2026-09-08T12:00:00.000Z"),
    lastObservedAt: "2026-09-08T11:59:59.000Z",
    latencyMs: 20,
    consecutiveFailures: 0,
    staleAfterMs: 5_000
  };
  assert.equal(deriveProviderHealth(base).status, "healthy");
  assert.equal(deriveProviderHealth({ ...base, enabled: false }).status, "disabled");
  assert.equal(deriveProviderHealth({ ...base, lastObservedAt: null, consecutiveFailures: 1 }).status, "unavailable");
  assert.equal(deriveProviderHealth({ ...base, lastObservedAt: "2026-09-08T11:59:50.000Z" }).status, "stale");
  assert.equal(deriveProviderHealth({ ...base, reasons: ["timestamp_missing"] }).status, "degraded");
});

test("bounded reads retry eligible failures and stop at the configured limit", async () => {
  let attempts = 0;
  const result = await runBoundedProviderRead({
    operation: "fixture",
    maxAttempts: 8,
    timeoutMs: 100,
    read: async ({ attempt }) => {
      attempts += 1;
      if (attempt < 3) throw new Error("retryable");
      return "ok";
    },
    isRetryable: () => true
  });
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);

  await assert.rejects(
    runBoundedProviderRead({
      operation: "timeout",
      maxAttempts: 1,
      timeoutMs: 5,
      read: async () => new Promise<string>(() => undefined),
      isRetryable: () => true
    }),
    (error) => error instanceof ProviderContractError && error.code === "provider_read_timeout"
  );

  let timedOutAttempts = 0;
  await assert.rejects(
    runBoundedProviderRead({
      operation: "timeout-with-retry-requested",
      maxAttempts: 3,
      timeoutMs: 5,
      read: async () => {
        timedOutAttempts += 1;
        return new Promise<string>(() => undefined);
      },
      isRetryable: () => true
    }),
    (error) => error instanceof ProviderContractError && error.code === "provider_read_timeout"
  );
  assert.equal(timedOutAttempts, 1);
});

test("execution identity binds tenant, connection and idempotency without routing an order", () => {
  const intent: ExecutionIntent = {
    schemaVersion: "1.0.0",
    executionId: "exec_1",
    idempotencyKey: "idem_1",
    tenantId: "tenant_1",
    exchangeConnectionId: "connection_1",
    providerId: "provider_1",
    venue: "bitget",
    marketType: "perpetual",
    symbol: "BTCUSDT",
    side: "buy",
    orderType: "limit",
    quantity: 0.001,
    price: 50_000,
    reduceOnly: false
  };
  assert.equal(canonicalExecutionIdentity(intent).key, 'v1:["tenant_1","connection_1","provider_1","exec_1","idem_1"]');
  assert.notEqual(
    canonicalExecutionIdentity({ ...intent, tenantId: "tenant:one", exchangeConnectionId: "connection" }).key,
    canonicalExecutionIdentity({ ...intent, tenantId: "tenant", exchangeConnectionId: "one:connection" }).key
  );
  assert.throws(
    () => canonicalExecutionIdentity({ ...intent, price: undefined }),
    (error) => error instanceof ProviderContractError && error.code === "execution_price_invalid"
  );
});

test("tenant mappings reject cross-tenant access before exposing provider references", () => {
  const binding = {
    tenantId: "tenant_1",
    exchangeConnectionId: "connection_1",
    providerId: "provider_1",
    providerAccountRef: "internal_account_1",
    enabled: true
  };
  assert.equal(assertProviderAccountBinding(binding, binding).providerAccountRef, "internal_account_1");
  assert.throws(
    () => assertProviderAccountBinding(binding, { ...binding, tenantId: "tenant_2" }),
    (error) => error instanceof ProviderContractError && error.code === "provider_account_binding_mismatch"
  );
  assert.throws(
    () => assertProviderAccountBinding({ ...binding, tenantId: "invalid value" }, { ...binding, tenantId: "invalid value" }),
    (error) => error instanceof ProviderContractError && error.code === "provider_tenant_id_invalid"
  );
});

test("diagnostics recursively redact credentials and bearer values", () => {
  const redacted = redactProviderDiagnostics({
    apiKey: "key-value",
    nested: {
      passphrase: "secret-value",
      accessKey: "access-value",
      secretKey: "secret-key-value",
      message: "Authorization: Bearer abcdefghijklmnop",
      alternate: "password=one token:two private_key=three Basic Zm9vOmJhcg=="
    },
    safe: "BTCUSDT"
  }) as Record<string, unknown>;
  assert.equal(redacted.apiKey, "[REDACTED]");
  assert.equal((redacted.nested as Record<string, unknown>).passphrase, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(redacted), /key-value|secret-value|access-value|secret-key-value|abcdefghijklmnop|one|two|three|Zm9vOmJhcg/);
  assert.equal(redacted.safe, "BTCUSDT");
});
