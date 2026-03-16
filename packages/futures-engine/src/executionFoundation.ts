import type { TradeIntent } from "@mm/futures-core";
import type {
  FuturesVenueCapabilities,
  PaperExecutionContext
} from "@mm/futures-exchange";
import { getFuturesVenueCapabilities } from "@mm/futures-exchange";
import type { EngineExecutionResult } from "./engine.js";

type MaybePromise<T> = T | Promise<T>;

export type SharedExecutionStatus = "executed" | "blocked" | "noop" | "failed";

export type SharedExecutionAction =
  | "place_order"
  | "close_position"
  | "cancel_order"
  | "edit_order"
  | "set_leverage"
  | "set_position_tpsl"
  | "provider_control"
  | "sync_state"
  | (string & {});

export type SharedExecutionVenue = {
  executionVenue?: string | null;
  marketDataVenue?: string | null;
  capabilities?: FuturesVenueCapabilities | null;
  paperContext?: PaperExecutionContext | null;
  skipValidation?: boolean;
};

export type SharedExecutionRequest = {
  domain: string;
  action: SharedExecutionAction;
  symbol?: string | null;
  intent?: TradeIntent | null;
  venue?: SharedExecutionVenue | null;
  metadata?: Record<string, unknown> | null;
};

export type SharedExecutionResponse = {
  status: SharedExecutionStatus;
  reason: string;
  orderIds: string[];
  metadata: Record<string, unknown>;
  request: {
    domain: string;
    action: string;
    symbol: string | null;
  };
  venue: {
    executionVenue: string | null;
    marketDataVenue: string | null;
    connectorKind: string | null;
    supportsPerpExecution: boolean | null;
    requiresLinkedMarketData: boolean | null;
  };
  intent: TradeIntent | null;
};

export type SharedExecutionResultInput = {
  status: SharedExecutionStatus;
  reason: string;
  orderIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
  intent?: TradeIntent | null;
};

export type SharedExecutionGuardrailResult =
  | {
      allow: true;
      metadata?: Record<string, unknown> | null;
    }
  | {
      allow: false;
      reason: string;
      status?: Extract<SharedExecutionStatus, "blocked" | "noop">;
      metadata?: Record<string, unknown> | null;
    };

export type SharedExecutionEvent = {
  phase: "requested" | "blocked" | "executed" | "noop" | "failed";
  request: SharedExecutionRequest;
  response?: SharedExecutionResponse;
  metadata: Record<string, unknown>;
};

export type SharedExecutionPipelineParams = {
  request: SharedExecutionRequest;
  translateRequest?: (
    request: SharedExecutionRequest
  ) => MaybePromise<SharedExecutionRequest>;
  guard?: (
    request: SharedExecutionRequest
  ) => MaybePromise<SharedExecutionGuardrailResult>;
  execute: (
    request: SharedExecutionRequest
  ) => MaybePromise<EngineExecutionResult | SharedExecutionResultInput>;
  emitEvent?: (event: SharedExecutionEvent) => MaybePromise<void>;
  onResult?: (
    response: SharedExecutionResponse,
    request: SharedExecutionRequest
  ) => MaybePromise<SharedExecutionResponse | void>;
  rethrowExecutionError?: boolean;
};

function normalizeSymbol(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeVenueName(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCapabilities(
  venue: SharedExecutionVenue | null | undefined
): FuturesVenueCapabilities | null {
  if (venue?.capabilities) return venue.capabilities;
  const executionVenue = normalizeVenueName(venue?.executionVenue);
  if (!executionVenue) return null;
  return getFuturesVenueCapabilities(executionVenue);
}

function resolveRequestSymbol(request: SharedExecutionRequest): string | null {
  if (request.intent && "symbol" in request.intent) {
    return normalizeSymbol(request.intent.symbol);
  }
  return normalizeSymbol(request.symbol);
}

function toOrderIds(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

function buildVenueMetadata(
  request: SharedExecutionRequest
): SharedExecutionResponse["venue"] {
  const capabilities = normalizeCapabilities(request.venue);
  return {
    executionVenue: normalizeVenueName(request.venue?.executionVenue),
    marketDataVenue: normalizeVenueName(
      request.venue?.paperContext?.linkedMarketData.marketDataVenue
        ?? request.venue?.marketDataVenue
    ),
    connectorKind: capabilities?.connectorKind ?? null,
    supportsPerpExecution:
      typeof capabilities?.supportsPerpExecution === "boolean"
        ? capabilities.supportsPerpExecution
        : null,
    requiresLinkedMarketData:
      typeof capabilities?.requiresLinkedMarketData === "boolean"
        ? capabilities.requiresLinkedMarketData
        : null
  };
}

export function buildSharedExecutionMetadata(
  request: SharedExecutionRequest,
  extra?: Record<string, unknown> | null
): Record<string, unknown> {
  const symbol = resolveRequestSymbol(request);
  const venue = buildVenueMetadata(request);
  return {
    executionFoundation: "shared_execution_pipeline_v1",
    executionDomain: request.domain,
    executionAction: String(request.action),
    executionSymbol: symbol,
    executionVenue: venue.executionVenue,
    marketDataVenue: venue.marketDataVenue,
    executionConnectorKind: venue.connectorKind,
    venueSupportsPerpExecution: venue.supportsPerpExecution,
    venueRequiresLinkedMarketData: venue.requiresLinkedMarketData,
    ...(request.metadata ?? {}),
    ...(extra ?? {})
  };
}

export function buildSharedExecutionVenue(params: {
  executionVenue?: string | null;
  marketDataVenue?: string | null;
  capabilities?: FuturesVenueCapabilities | null;
  paperContext?: PaperExecutionContext | null;
  skipValidation?: boolean;
}): SharedExecutionVenue {
  return {
    executionVenue: normalizeVenueName(params.executionVenue),
    marketDataVenue: normalizeVenueName(params.marketDataVenue),
    capabilities: params.capabilities ?? null,
    paperContext: params.paperContext ?? null,
    skipValidation: params.skipValidation === true
  };
}

function isEngineExecutionResult(
  value: EngineExecutionResult | SharedExecutionResultInput
): value is EngineExecutionResult {
  return (
    value.status === "accepted"
    || value.status === "blocked"
    || value.status === "noop"
  );
}

function toResultInput(
  result: EngineExecutionResult | SharedExecutionResultInput
): SharedExecutionResultInput {
  if (!isEngineExecutionResult(result)) return result;

  if (result.status === "accepted") {
    return {
      status: "executed",
      reason: "accepted",
      orderIds: result.orderId ? [result.orderId] : [],
      metadata: {
        engineStatus: result.status
      }
    };
  }

  if (result.status === "blocked") {
    return {
      status: "blocked",
      reason: result.reason,
      orderIds: [],
      metadata: {
        engineStatus: result.status,
        engineReason: result.reason
      }
    };
  }

  return {
    status: "noop",
    reason: "noop",
    orderIds: [],
    metadata: {
      engineStatus: result.status
    }
  };
}

export function normalizeSharedExecutionResponse(
  request: SharedExecutionRequest,
  result: EngineExecutionResult | SharedExecutionResultInput
): SharedExecutionResponse {
  const normalized = toResultInput(result);
  return {
    status: normalized.status,
    reason: normalized.reason,
    orderIds: toOrderIds(normalized.orderIds),
    metadata: buildSharedExecutionMetadata(request, normalized.metadata ?? null),
    request: {
      domain: request.domain,
      action: String(request.action),
      symbol: resolveRequestSymbol(request)
    },
    venue: buildVenueMetadata(request),
    intent: normalized.intent ?? request.intent ?? null
  };
}

export function validateSharedExecutionVenue(
  request: SharedExecutionRequest
): SharedExecutionResponse | null {
  if (request.venue?.skipValidation === true) return null;

  const capabilities = normalizeCapabilities(request.venue);
  if (!capabilities) return null;

  if (!capabilities.supportsPerpExecution) {
    return normalizeSharedExecutionResponse(request, {
      status: "blocked",
      reason:
        capabilities.connectorKind === "market_data_only"
          ? "execution_venue_market_data_only"
          : "execution_venue_unsupported",
      metadata: {
        validationStage: "venue_capability"
      }
    });
  }

  const paperContext = request.venue?.paperContext;
  if (paperContext && paperContext.linkedMarketData.supported !== true) {
    return normalizeSharedExecutionResponse(request, {
      status: "blocked",
      reason:
        paperContext.linkedMarketData.supportCode
        ?? "paper_linked_market_data_unsupported",
      metadata: {
        validationStage: "paper_market_data_link"
      }
    });
  }

  return null;
}

async function emitPipelineEvent(
  emitEvent: SharedExecutionPipelineParams["emitEvent"] | undefined,
  phase: SharedExecutionEvent["phase"],
  request: SharedExecutionRequest,
  response?: SharedExecutionResponse
) {
  if (!emitEvent) return;
  await emitEvent({
    phase,
    request,
    response,
    metadata: response?.metadata ?? buildSharedExecutionMetadata(request)
  });
}

export async function executeSharedExecutionPipeline(
  params: SharedExecutionPipelineParams
): Promise<SharedExecutionResponse> {
  const translatedRequest = params.translateRequest
    ? await params.translateRequest(params.request)
    : params.request;

  await emitPipelineEvent(params.emitEvent, "requested", translatedRequest);

  const venueValidation = validateSharedExecutionVenue(translatedRequest);
  if (venueValidation) {
    await emitPipelineEvent(
      params.emitEvent,
      venueValidation.status,
      translatedRequest,
      venueValidation
    );
    return venueValidation;
  }

  if (params.guard) {
    const guard = await params.guard(translatedRequest);
    if (!guard.allow) {
      const guarded = normalizeSharedExecutionResponse(translatedRequest, {
        status: guard.status ?? "blocked",
        reason: guard.reason,
        metadata: {
          validationStage: "guardrail",
          ...(guard.metadata ?? {})
        }
      });
      await emitPipelineEvent(params.emitEvent, guarded.status, translatedRequest, guarded);
      return guarded;
    }
  }

  try {
    const rawResult = await params.execute(translatedRequest);
    let response = normalizeSharedExecutionResponse(translatedRequest, rawResult);
    if (params.onResult) {
      response = (await params.onResult(response, translatedRequest)) ?? response;
    }
    await emitPipelineEvent(params.emitEvent, response.status, translatedRequest, response);
    return response;
  } catch (error) {
    const failed = normalizeSharedExecutionResponse(translatedRequest, {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      metadata: {
        errorName: error instanceof Error ? error.name : null
      }
    });
    await emitPipelineEvent(params.emitEvent, failed.status, translatedRequest, failed);
    if (params.rethrowExecutionError) {
      throw error;
    }
    return failed;
  }
}
