import assert from "node:assert/strict";
import test from "node:test";
import { MARKET_SESSION_DEFINITIONS, formatSessionCountdown, getMarketSessionState } from "./marketSessions";

function market(id: string) {
  const definition = MARKET_SESSION_DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`missing_market:${id}`);
  return definition;
}

test("New York session uses its IANA timezone for open and close countdowns", () => {
  const now = new Date("2026-09-08T14:00:00.000Z");
  const state = getMarketSessionState(market("newYork"), now);
  assert.equal(state.isOpen, true);
  assert.equal(state.localTime, "10:00");
  assert.equal(state.nextAction, "close");
  assert.equal(state.nextAt.toISOString(), "2026-09-08T20:00:00.000Z");
  assert.equal(formatSessionCountdown(state.nextAt, now), "06:00:00");
});

test("Tokyo lunch break counts down to the afternoon opening", () => {
  const now = new Date("2026-09-08T03:00:00.000Z");
  const state = getMarketSessionState(market("tokyo"), now);
  assert.equal(state.isOpen, false);
  assert.equal(state.localTime, "12:00");
  assert.equal(state.nextAction, "open");
  assert.equal(state.nextAt.toISOString(), "2026-09-08T03:30:00.000Z");
});

test("weekend sessions point to the next Monday opening", () => {
  const now = new Date("2026-09-12T12:00:00.000Z");
  const state = getMarketSessionState(market("london"), now);
  assert.equal(state.isOpen, false);
  assert.equal(state.nextAt.toISOString(), "2026-09-14T07:00:00.000Z");
});
