import type { AiChatResult, CallAiChatOptions, ChatMessage } from "../ai/provider.js";
import { analyzeWithAiGuards } from "../ai/analyzer.js";
import {
  assertAiOutputWithinBoundary,
  buildAiAgentSystemMessage,
  getAiAgentPolicy,
  wrapUntrustedAiPayload
} from "../ai/safety/toolPolicy.js";
import { getAiToolDefinitionsForAgent } from "../ai/tools/index.js";
import {
  buildDeterministicPositionAnalysis,
  type PositionCopilotAnalysis,
  type PositionCopilotFinding,
  type PositionCopilotRiskLevel,
  type PositionCopilotSnapshot
} from "./core.js";

export const POSITION_COPILOT_TOOLS = getAiToolDefinitionsForAgent("position_monitoring");
export const POSITION_COPILOT_SYSTEM_MESSAGE = buildAiAgentSystemMessage("position_monitoring", [
  "You are the read-only uLiquid Position Copilot.",
  "Explain the supplied position snapshot in plain language. Never recommend or perform an order, close, reduction, TP/SL change, leverage change, margin change, copier-rule change, wallet signature or other execution action.",
  "Do not invent missing market data. Return only the requested JSON."
].join(" "));

type CallAiChat = (
  messages: ChatMessage[],
  options: CallAiChatOptions
) => Promise<AiChatResult>;

type AiPositionCopilotResponse = {
  summary: string;
  thesisStatus: PositionCopilotAnalysis["thesisStatus"];
  riskLevel: PositionCopilotRiskLevel;
  riskFactors: PositionCopilotFinding[];
  events: PositionCopilotFinding[];
};

const RISK_WEIGHT: Record<PositionCopilotRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeRiskLevel(value: unknown): PositionCopilotRiskLevel {
  return value === "critical" || value === "high" || value === "medium" ? value : "low";
}

function normalizeThesisStatus(value: unknown): PositionCopilotAnalysis["thesisStatus"] {
  return value === "intact" || value === "weakened" || value === "invalidated" ? value : "unknown";
}

function normalizeFindings(value: unknown): PositionCopilotFinding[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((row, index) => {
    const record = asRecord(row);
    return {
      code: String(record.code ?? `ai_finding_${index + 1}`).replace(/[^a-z0-9_]/gi, "_").slice(0, 64),
      severity: normalizeRiskLevel(record.severity),
      message: String(record.message ?? "").trim().slice(0, 320)
    };
  }).filter((row) => row.message.length > 0);
}

function parseAiResponse(content: string): AiPositionCopilotResponse {
  const record = asRecord(JSON.parse(content));
  assertAiOutputWithinBoundary("position_monitoring", record);
  const summary = String(record.summary ?? "").trim().slice(0, 800);
  if (!summary) throw new Error("position_copilot_ai_summary_missing");
  return {
    summary,
    thesisStatus: normalizeThesisStatus(record.thesisStatus),
    riskLevel: normalizeRiskLevel(record.riskLevel),
    riskFactors: normalizeFindings(record.riskFactors),
    events: normalizeFindings(record.events)
  };
}

function mergeAnalysis(
  deterministic: PositionCopilotAnalysis,
  ai: AiPositionCopilotResponse,
  now: Date
): PositionCopilotAnalysis {
  const riskLevel = RISK_WEIGHT[ai.riskLevel] > RISK_WEIGHT[deterministic.riskLevel]
    ? ai.riskLevel
    : deterministic.riskLevel;
  return {
    ...deterministic,
    riskLevel,
    thesisStatus: deterministic.dataQuality.state === "degraded" ? "unknown" : ai.thesisStatus,
    summary: ai.summary,
    riskFactors: [...deterministic.riskFactors, ...ai.riskFactors].slice(0, 10),
    events: [...deterministic.events, ...ai.events].slice(0, 10),
    generatedAt: now.toISOString()
  };
}

const POSITION_COPILOT_RESPONSE_FORMAT: NonNullable<CallAiChatOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "position_copilot_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "thesisStatus", "riskLevel", "riskFactors", "events"],
      properties: {
        summary: { type: "string" },
        thesisStatus: { type: "string", enum: ["intact", "weakened", "invalidated", "unknown"] },
        riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
        riskFactors: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "severity", "message"],
            properties: {
              code: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              message: { type: "string" }
            }
          }
        },
        events: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "severity", "message"],
            properties: {
              code: { type: "string" },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              message: { type: "string" }
            }
          }
        }
      }
    }
  }
};

export async function analyzePositionSnapshot(params: {
  snapshot: PositionCopilotSnapshot;
  userId: string;
  callAiChat: CallAiChat;
  language?: "de" | "en";
  now?: Date;
}): Promise<{
  analysis: PositionCopilotAnalysis;
  cacheHit: boolean;
  fallbackUsed: boolean;
  rateLimited: boolean;
  fallbackReason: string | null;
  provider: string | null;
  model: string | null;
}> {
  const now = params.now ?? new Date();
  const language = params.language === "de" ? "de" : "en";
  const agentPolicy = getAiAgentPolicy("position_monitoring");
  const deterministic = buildDeterministicPositionAnalysis(params.snapshot, now, language);
  let provider: string | null = null;
  let model: string | null = null;
  const guarded = await analyzeWithAiGuards({
    cacheKey: `position-copilot:${params.userId}:${language}:${deterministic.snapshotHash}`,
    ttlSec: 300,
    rateLimitPerMin: 12,
    aiModel: "position-copilot",
    fallback: () => deterministic,
    compute: async () => {
      const result = await params.callAiChat([
        { role: "system", content: POSITION_COPILOT_SYSTEM_MESSAGE },
        {
          role: "user",
          content: JSON.stringify(wrapUntrustedAiPayload({
            task: `Explain risk, thesis state, relevant changes and data quality in ${language === "de" ? "German" : "English"}. Do not propose actions.`,
            snapshot: params.snapshot
          }))
        }
      ], {
        billingUserId: params.userId,
        billingScope: "position_copilot",
        temperature: 0.1,
        maxTokens: agentPolicy.maxOutputTokens,
        tools: POSITION_COPILOT_TOOLS,
        toolChoice: "none",
        responseFormat: POSITION_COPILOT_RESPONSE_FORMAT
      });
      provider = result.provider;
      model = result.model;
      if (result.toolCalls.length > 0) throw new Error("position_copilot_tool_call_rejected");
      return mergeAnalysis(deterministic, parseAiResponse(result.content), now);
    }
  });
  return {
    analysis: guarded.value,
    cacheHit: guarded.cacheHit,
    fallbackUsed: guarded.fallbackUsed,
    rateLimited: guarded.rateLimited,
    fallbackReason: guarded.fallbackReason,
    provider,
    model
  };
}
