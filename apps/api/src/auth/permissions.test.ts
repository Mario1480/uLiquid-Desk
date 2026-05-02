import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPermissionRequirement,
  resolvePermissionRequirementForRequest
} from "./permissions.js";

test("manual orders select market or limit permission from payload", () => {
  assert.deepEqual(
    resolvePermissionRequirementForRequest("POST", "/api/orders", { orderType: "market" }),
    { any: ["trading.manual_market"] }
  );
  assert.deepEqual(
    resolvePermissionRequirementForRequest("POST", "/api/orders", { orderType: "limit" }),
    { any: ["trading.manual_limit"] }
  );
});

test("feature routes map to expected RBAC permissions", () => {
  assert.deepEqual(resolvePermissionRequirementForRequest("POST", "/bots", {}), { any: ["bots.create"] });
  assert.deepEqual(resolvePermissionRequirementForRequest("PUT", "/bots/bot_1", {}), { any: ["bots.edit_config"] });
  assert.deepEqual(resolvePermissionRequirementForRequest("POST", "/bots/bot_1/start", {}), {
    any: ["bots.start_pause_stop"]
  });
  assert.deepEqual(resolvePermissionRequirementForRequest("PUT", "/settings/risk/acct_1", {}), { any: ["risk.edit"] });
  assert.deepEqual(resolvePermissionRequirementForRequest("POST", "/exchange-accounts", {}), {
    any: ["exchange_keys.edit"]
  });
  assert.deepEqual(resolvePermissionRequirementForRequest("POST", "/grid/templates/tpl_1/instances?draft=1", {}), {
    any: ["bots.create"]
  });
});

test("trading desk read and settings routes map consistently", () => {
  const manualRead = { any: ["trading.manual_market", "trading.manual_limit"] };
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/account/summary", {}), manualRead);
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/positions", {}), manualRead);
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/orders/open", {}), manualRead);
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/market/candles", {}), manualRead);
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/symbols", {}), {
    any: ["bots.view", "trading.manual_market", "trading.manual_limit"]
  });
  assert.deepEqual(resolvePermissionRequirementForRequest("GET", "/api/trading/settings", {}), {
    any: ["bots.view", "trading.manual_market", "trading.manual_limit"]
  });
  assert.deepEqual(resolvePermissionRequirementForRequest("POST", "/api/trading/settings", {}), {
    any: ["bots.view", "trading.manual_market", "trading.manual_limit"]
  });
});

test("hasPermissionRequirement allows any matching permission", () => {
  assert.equal(
    hasPermissionRequirement({ "trading.manual_limit": true }, { any: ["trading.manual_market", "trading.manual_limit"] }),
    true
  );
  assert.equal(
    hasPermissionRequirement({ "bots.view": true }, { any: ["bots.delete"] }),
    false
  );
});
