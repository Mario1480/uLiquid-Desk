import assert from "node:assert/strict";
import test from "node:test";
import { createRiskPolicyService } from "./riskPolicy.service.js";
import { RiskPolicyError } from "./riskPolicy.types.js";

function createDb() {
  const templates = new Map<string, any>([
    [
      "legacy_grid_default",
      {
        id: "legacy_grid_default",
        isActive: true,
        allowedSymbols: [],
        minAllocationUsd: 0.01,
        maxAllocationUsd: 1_000_000,
        maxLeverage: 125
      }
    ],
    [
      "tpl_grid",
      {
        id: "tpl_grid",
        isActive: true,
        allowedSymbols: ["BTCUSDT", "ETHUSDT"],
        minAllocationUsd: 50,
        maxAllocationUsd: 500,
        maxLeverage: 5
      }
    ],
    [
      "tpl_inactive",
      {
        id: "tpl_inactive",
        isActive: false,
        allowedSymbols: ["BTCUSDT"],
        minAllocationUsd: 10,
        maxAllocationUsd: 100,
        maxLeverage: 3
      }
    ]
  ]);

  return {
    botTemplate: {
      async findUnique(args: any) {
        const id = String(args?.where?.id ?? "");
        return templates.get(id) ?? null;
      }
    }
  };
}

test("assertCanCreateBotVault validates allocation/leverage/symbol", async () => {
  const service = createRiskPolicyService(createDb());

  await service.assertCanCreateBotVault({
    templateId: "tpl_grid",
    symbol: "BTCUSDT",
    leverage: 3,
    allocationUsd: 100
  });

  await assert.rejects(
    service.assertCanCreateBotVault({
      templateId: "tpl_grid",
      symbol: "BTCUSDT",
      leverage: 3,
      allocationUsd: 40
    }),
    (error: any) => {
      assert.equal(error instanceof RiskPolicyError, true);
      assert.equal(error.code, "risk_allocation_below_minimum");
      return true;
    }
  );

  await assert.rejects(
    service.assertCanCreateBotVault({
      templateId: "tpl_grid",
      symbol: "BTCUSDT",
      leverage: 7,
      allocationUsd: 100
    }),
    /risk_leverage_above_template_max/
  );

  await assert.rejects(
    service.assertCanCreateBotVault({
      templateId: "tpl_grid",
      symbol: "SOLUSDT",
      leverage: 3,
      allocationUsd: 100
    }),
    /risk_symbol_not_allowed/
  );
});

test("assertCanTopUpBotVault blocks when resulting allocation exceeds template max", async () => {
  const service = createRiskPolicyService(createDb());

  await service.assertCanTopUpBotVault({
    templateId: "tpl_grid",
    symbol: "ETHUSDT",
    leverage: 5,
    resultingAllocationUsd: 500
  });

  await assert.rejects(
    service.assertCanTopUpBotVault({
      templateId: "tpl_grid",
      symbol: "ETHUSDT",
      leverage: 5,
      resultingAllocationUsd: 600
    }),
    /risk_allocation_above_maximum/
  );
});

test("assertCanStartOrResume blocks inactive template and excessive leverage", async () => {
  const service = createRiskPolicyService(createDb());

  await assert.rejects(
    service.assertCanStartOrResume({
      templateId: "tpl_inactive",
      symbol: "BTCUSDT",
      leverage: 1
    }),
    /risk_template_inactive/
  );

  await assert.rejects(
    service.assertCanStartOrResume({
      templateId: "tpl_grid",
      symbol: "BTCUSDT",
      leverage: 10
    }),
    /risk_leverage_above_template_max/
  );
});

test("assertStatusTransition enforces lifecycle matrix", async () => {
  const service = createRiskPolicyService(createDb());

  service.assertStatusTransition({ fromStatus: "ACTIVE", toStatus: "PAUSED" });
  service.assertStatusTransition({ fromStatus: "STOPPED", toStatus: "ACTIVE" });
  service.assertStatusTransition({ fromStatus: "ERROR", toStatus: "CLOSE_ONLY" });
  service.assertStatusTransition({ fromStatus: "ERROR", toStatus: "CLOSED", forceClose: true });

  assert.throws(
    () => service.assertStatusTransition({ fromStatus: "ACTIVE", toStatus: "CLOSED" }),
    /risk_invalid_status_transition/
  );
  assert.throws(
    () => service.assertStatusTransition({ fromStatus: "CLOSED", toStatus: "ACTIVE" }),
    /risk_invalid_status_transition/
  );
});

test("assertStatusTransition covers allow/deny matrix for MVP states", () => {
  const service = createRiskPolicyService(createDb());

  const allowed: Array<{ from: string; to: string; forceClose?: boolean }> = [
    { from: "ACTIVE", to: "PAUSED" },
    { from: "ACTIVE", to: "CLOSE_ONLY" },
    { from: "PAUSED", to: "ACTIVE" },
    { from: "PAUSED", to: "CLOSE_ONLY" },
    { from: "STOPPED", to: "ACTIVE" },
    { from: "STOPPED", to: "CLOSE_ONLY" },
    { from: "CLOSE_ONLY", to: "CLOSED" },
    { from: "ERROR", to: "CLOSE_ONLY" },
    { from: "ERROR", to: "CLOSED", forceClose: true }
  ];
  const denied: Array<{ from: string; to: string; forceClose?: boolean }> = [
    { from: "ACTIVE", to: "CLOSED" },
    { from: "PAUSED", to: "CLOSED" },
    { from: "CLOSE_ONLY", to: "ACTIVE" },
    { from: "ERROR", to: "CLOSED" },
    { from: "CLOSED", to: "PAUSED" }
  ];

  for (const entry of allowed) {
    service.assertStatusTransition({
      fromStatus: entry.from,
      toStatus: entry.to,
      forceClose: entry.forceClose
    });
  }

  for (const entry of denied) {
    assert.throws(
      () => service.assertStatusTransition({
        fromStatus: entry.from,
        toStatus: entry.to,
        forceClose: entry.forceClose
      }),
      /risk_invalid_status_transition/
    );
  }
});

test("evaluateRuntimeGuardrails returns pause action on hard breaches", async () => {
  const service = createRiskPolicyService(createDb());

  const hard = await service.evaluateRuntimeGuardrails({
    templateId: "tpl_grid",
    symbol: "SOLUSDT",
    leverage: 10,
    allocationUsd: 100
  });

  assert.equal(hard.breached, true);
  assert.equal(hard.severity, "hard");
  assert.equal(hard.action, "pause");
  assert.equal(hard.violations[0]?.code, "risk_guardrail_emergency_pause_required");

  const soft = await service.evaluateRuntimeGuardrails({
    templateId: "tpl_grid",
    symbol: "BTCUSDT",
    leverage: 5,
    allocationUsd: 700
  });

  assert.equal(soft.breached, true);
  assert.equal(soft.severity, "soft");
  assert.equal(soft.action, "none");
  assert.equal(soft.violations.some((entry) => entry.code === "risk_allocation_above_maximum"), true);

  const clean = await service.evaluateRuntimeGuardrails({
    templateId: "tpl_grid",
    symbol: "BTCUSDT",
    leverage: 3,
    allocationUsd: 100
  });

  assert.deepEqual(clean, {
    breached: false,
    severity: "none",
    action: "none",
    violations: []
  });
});
