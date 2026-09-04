import {
  analyzeFundingSnapshot,
  analyzeOpenInterestSnapshot,
  analyzeOrderbookSnapshot,
  MARKET_ANALYTICS_ROUTINE_VERSIONS
} from "@mm/futures-core";
import { ATR, EMA, RSI, SMA } from "technicalindicators";
import { z } from "zod";
import {
  buildDeterministicPositionAnalysis,
  buildPositionCopilotSnapshot
} from "../../position-copilot/core.js";

export const AGENT_ROUTINE_IDS = {
  technicalIndicatorSummary: "market.technical-indicator-summary.v1",
  fundingSnapshot: MARKET_ANALYTICS_ROUTINE_VERSIONS.fundingSnapshot,
  openInterestSnapshot: MARKET_ANALYTICS_ROUTINE_VERSIONS.openInterestSnapshot,
  orderbookSnapshot: MARKET_ANALYTICS_ROUTINE_VERSIONS.orderbookSnapshot,
  positionSnapshot: "position.snapshot.v1",
  positionRisk: "position.risk.v1"
} as const;

export type AgentRoutineId = typeof AGENT_ROUTINE_IDS[keyof typeof AGENT_ROUTINE_IDS];

const nullableFiniteNumber = z.number().finite().nullable();
const qualitySchema = z.object({
  state: z.enum(["fresh", "stale", "degraded", "unavailable"]),
  reasons: z.array(z.string())
}).strict();

const candleSchema = z.object({
  ts: z.number().finite(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().finite()
}).strict();

const technicalIndicatorInputSchema = z.object({
  candles: z.array(candleSchema),
  indicators: z.array(z.enum(["sma20", "ema50", "rsi14", "atr14"])).max(8)
}).strict();

const technicalIndicatorOutputSchema = z.object({
  routineId: z.literal(AGENT_ROUTINE_IDS.technicalIndicatorSummary),
  values: z.object({
    sma20: nullableFiniteNumber.optional(),
    ema50: nullableFiniteNumber.optional(),
    rsi14: nullableFiniteNumber.optional(),
    atr14: nullableFiniteNumber.optional()
  }).strict(),
  quality: qualitySchema
}).strict();

const fundingInputSchema = z.object({
  rate: nullableFiniteNumber,
  fundingIntervalHours: nullableFiniteNumber.optional()
}).strict();

const fundingOutputSchema = z.object({
  routineId: z.literal(AGENT_ROUTINE_IDS.fundingSnapshot),
  rate: nullableFiniteNumber,
  rateBps: nullableFiniteNumber,
  direction: z.enum(["positive", "flat", "negative", "unknown"]),
  fundingIntervalHours: nullableFiniteNumber,
  annualizedEstimate: nullableFiniteNumber,
  historicalContextAvailable: z.literal(false),
  quality: qualitySchema
}).strict();

const openInterestUnitSchema = z.enum(["base_asset", "quote_asset", "contracts", "provider_native", "unknown"]);
const openInterestInputSchema = z.object({
  reportedValue: nullableFiniteNumber,
  reportedUnit: openInterestUnitSchema,
  referencePrice: nullableFiniteNumber.optional(),
  contractSize: nullableFiniteNumber.optional()
}).strict();

const openInterestOutputSchema = z.object({
  routineId: z.literal(AGENT_ROUTINE_IDS.openInterestSnapshot),
  reportedValue: nullableFiniteNumber,
  reportedUnit: openInterestUnitSchema,
  normalizedBaseQuantity: nullableFiniteNumber,
  notionalUsd: nullableFiniteNumber,
  historicalContextAvailable: z.literal(false),
  quality: qualitySchema
}).strict();

const levelSchema = z.tuple([z.number().finite(), z.number().finite()]);
const orderbookInputSchema = z.object({ bids: z.array(levelSchema), asks: z.array(levelSchema) }).strict();
const orderbookOutputSchema = z.object({
  routineId: z.literal(AGENT_ROUTINE_IDS.orderbookSnapshot),
  midPrice: nullableFiniteNumber,
  spreadBps: nullableFiniteNumber,
  weightedMid: nullableFiniteNumber,
  bands: z.array(z.object({
    bandBps: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]),
    bidDepthUsd: z.number().finite(),
    askDepthUsd: z.number().finite(),
    depthRatio: nullableFiniteNumber,
    imbalance: nullableFiniteNumber
  }).strict()),
  quality: qualitySchema
}).strict();

const positionInputSchema = z.object({
  input: z.record(z.unknown()),
  locale: z.enum(["de", "en"]).optional()
}).strict();

const positionSnapshotOutputSchema = z.object({
  exchangeAccountId: z.string(),
  exchange: z.string(),
  marketType: z.enum(["spot", "perp"]),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  size: z.number().finite(),
  entryPrice: nullableFiniteNumber,
  markPrice: nullableFiniteNumber,
  unrealizedPnlUsd: nullableFiniteNumber,
  leverage: nullableFiniteNumber,
  marginMode: z.enum(["isolated", "cross"]).nullable(),
  marginUsd: nullableFiniteNumber,
  notionalUsd: nullableFiniteNumber,
  liquidationPrice: nullableFiniteNumber,
  liquidationDistancePct: nullableFiniteNumber,
  roePct: nullableFiniteNumber,
  pnlPct: nullableFiniteNumber,
  stopLossPrice: nullableFiniteNumber,
  takeProfitPrice: nullableFiniteNumber,
  dataDegraded: z.boolean(),
  observedAt: z.string().datetime(),
  openedByPredictionCopier: z.boolean()
}).strict();

const findingSchema = z.object({ code: z.string(), severity: z.enum(["low", "medium", "high", "critical"]), message: z.string() }).strict();
const positionRiskOutputSchema = z.object({
  routineId: z.literal(AGENT_ROUTINE_IDS.positionRisk),
  analysis: z.object({
    snapshotHash: z.string(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    thesisStatus: z.enum(["intact", "weakened", "invalidated", "unknown"]),
    summary: z.string(),
    riskFactors: z.array(findingSchema),
    events: z.array(findingSchema),
    dataQuality: z.object({ state: z.enum(["complete", "degraded"]), missingFields: z.array(z.string()), observedAt: z.string().datetime() }).strict(),
    openedByPredictionCopier: z.boolean(),
    readOnly: z.literal(true),
    generatedAt: z.string().datetime()
  }).strict()
}).strict();

export type AgentRoutineDescriptor = {
  id: AgentRoutineId;
  version: `${number}.${number}.${number}`;
  owner: "futures-core" | "agent-chat" | "position-copilot";
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  execute(input: unknown): unknown;
};

function computeTechnicalIndicatorSummary(input: z.infer<typeof technicalIndicatorInputSchema>) {
  const closes = input.candles.map((row) => row.close);
  const values: Record<string, number | null> = {};
  if (input.indicators.includes("sma20")) values.sma20 = SMA.calculate({ period: 20, values: closes }).at(-1) ?? null;
  if (input.indicators.includes("ema50")) values.ema50 = EMA.calculate({ period: 50, values: closes }).at(-1) ?? null;
  if (input.indicators.includes("rsi14")) values.rsi14 = RSI.calculate({ period: 14, values: closes }).at(-1) ?? null;
  if (input.indicators.includes("atr14")) {
    values.atr14 = ATR.calculate({ period: 14, high: input.candles.map((row) => row.high), low: input.candles.map((row) => row.low), close: closes }).at(-1) ?? null;
  }
  return {
    routineId: AGENT_ROUTINE_IDS.technicalIndicatorSummary,
    values,
    quality: {
      state: input.candles.length < 50 ? "degraded" as const : "fresh" as const,
      reasons: input.candles.length < 50 ? ["insufficient_indicator_history"] : []
    }
  };
}

export const AGENT_ROUTINES: readonly AgentRoutineDescriptor[] = [
  { id: AGENT_ROUTINE_IDS.technicalIndicatorSummary, version: "1.0.0", owner: "agent-chat", inputSchema: technicalIndicatorInputSchema, outputSchema: technicalIndicatorOutputSchema, execute: computeTechnicalIndicatorSummary },
  { id: AGENT_ROUTINE_IDS.fundingSnapshot, version: "1.0.0", owner: "futures-core", inputSchema: fundingInputSchema, outputSchema: fundingOutputSchema, execute: analyzeFundingSnapshot },
  { id: AGENT_ROUTINE_IDS.openInterestSnapshot, version: "1.0.0", owner: "futures-core", inputSchema: openInterestInputSchema, outputSchema: openInterestOutputSchema, execute: analyzeOpenInterestSnapshot },
  { id: AGENT_ROUTINE_IDS.orderbookSnapshot, version: "1.0.0", owner: "futures-core", inputSchema: orderbookInputSchema, outputSchema: orderbookOutputSchema, execute: analyzeOrderbookSnapshot },
  { id: AGENT_ROUTINE_IDS.positionSnapshot, version: "1.0.0", owner: "position-copilot", inputSchema: positionInputSchema, outputSchema: positionSnapshotOutputSchema, execute: (value) => buildPositionCopilotSnapshot(positionInputSchema.parse(value).input) },
  { id: AGENT_ROUTINE_IDS.positionRisk, version: "1.0.0", owner: "position-copilot", inputSchema: positionInputSchema, outputSchema: positionRiskOutputSchema, execute: (value) => { const parsed = positionInputSchema.parse(value); const snapshot = buildPositionCopilotSnapshot(parsed.input); return { routineId: AGENT_ROUTINE_IDS.positionRisk, analysis: buildDeterministicPositionAnalysis(snapshot, new Date(), parsed.locale ?? "en") }; } }
];

const routinesById = new Map(AGENT_ROUTINES.map((routine) => [routine.id, routine]));

export function getAgentRoutine(id: AgentRoutineId): AgentRoutineDescriptor {
  const routine = routinesById.get(id);
  if (!routine) throw new Error(`agent_routine_not_found:${id}`);
  return routine;
}

export function executeAgentRoutine<T = unknown>(id: AgentRoutineId, input: unknown): T {
  const routine = getAgentRoutine(id);
  const parsedInput = routine.inputSchema.parse(input);
  return routine.outputSchema.parse(routine.execute(parsedInput)) as T;
}

export function routineVersionRefs(ids: readonly AgentRoutineId[]): Array<{ id: AgentRoutineId; version: string }> {
  return ids.map((id) => { const routine = getAgentRoutine(id); return { id: routine.id, version: routine.version }; });
}
