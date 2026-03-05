import { FuturesEngine } from "@mm/futures-engine";
import { writeRiskEvent } from "../db.js";
import type { ExecutionMode } from "./types.js";
import { createSimpleExecutionMode } from "./simpleExecutionMode.js";

type Dependencies = {
  engine?: FuturesEngine;
  writeRiskEventFn?: typeof writeRiskEvent;
};

// Legacy compatibility wrapper: keep old mode key while delegating to the new simple mode.
export function createLegacyFuturesExecutionMode(deps: Dependencies = {}): ExecutionMode {
  return createSimpleExecutionMode({
    engine: deps.engine,
    writeRiskEventFn: deps.writeRiskEventFn,
    key: "futures_engine"
  });
}
