import type { TradeIntent } from "@mm/futures-core";
import {
  executeSharedExecutionPipeline,
  type SharedExecutionPipelineParams,
  type SharedExecutionResponse
} from "@mm/futures-engine";
import type { RunnerGateSummary } from "../runtime/decisionTrace.js";
import type { ExecutionResult } from "./types.js";

function mapSharedStatusToRunnerStatus(
  status: SharedExecutionResponse["status"]
): ExecutionResult["status"] {
  if (status === "executed") return "executed";
  if (status === "blocked") return "blocked";
  if (status === "noop") return "noop";
  return "error";
}

function mapSharedStatusToLegacyOutcome(
  status: SharedExecutionResponse["status"]
): ExecutionResult["legacy"]["outcome"] {
  return status === "blocked" || status === "failed" ? "blocked" : "ok";
}

export function toRunnerExecutionResult(params: {
  response: SharedExecutionResponse;
  intent: TradeIntent;
  gate: RunnerGateSummary;
}): ExecutionResult {
  return {
    status: mapSharedStatusToRunnerStatus(params.response.status),
    reason: params.response.reason,
    orderIds: params.response.orderIds.length > 0 ? params.response.orderIds : undefined,
    metadata: {
      ...params.response.metadata
    },
    legacy: {
      outcome: mapSharedStatusToLegacyOutcome(params.response.status),
      intent: params.response.intent ?? params.intent,
      gate: params.gate
    },
    shared: params.response
  };
}

export async function executeRunnerSharedExecutionPipeline(
  params: SharedExecutionPipelineParams & {
    intent: TradeIntent;
    gate: RunnerGateSummary;
  }
): Promise<ExecutionResult> {
  const response = await executeSharedExecutionPipeline(params);
  return toRunnerExecutionResult({
    response,
    intent: params.intent,
    gate: params.gate
  });
}
