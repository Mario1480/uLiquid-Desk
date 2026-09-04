import type { AgentDecisionLog, AgentDecisionLogQuality, AgentMarketType, AgentUiBlock, AgentVenue } from "./contracts.js";
import { agentUiBlockSchema } from "./schemas.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quality(value: unknown, status: string): AgentDecisionLogQuality {
  if (["fresh", "stale", "degraded", "unavailable"].includes(String(value))) return value as AgentDecisionLogQuality;
  if (status === "success") return "fresh";
  if (status === "degraded") return "degraded";
  return "unavailable";
}

function routineVersions(value: unknown): Array<{ id: string; version: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item); const id = text(row.id);
    const rawVersion = typeof row.version === "number" && Number.isInteger(row.version) ? `${row.version}.0.0` : text(row.version);
    return id && rawVersion && /^\d+\.\d+\.\d+$/.test(rawVersion) ? [{ id, version: rawVersion }] : [];
  });
}

function validatedBlocks(value: unknown): AgentUiBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    const parsed = agentUiBlockSchema.safeParse(block);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, 12);
}

function legacyAssistant(run: any, messages: any[]): any | null {
  const start = new Date(run.createdAt).getTime();
  const endBase = run.completedAt ? new Date(run.completedAt).getTime() : start;
  const end = endBase + 30_000;
  return messages
    .filter((message) => message.role === "assistant")
    .filter((message) => { const at = new Date(message.createdAt).getTime(); return at >= start && at <= end; })
    .sort((a, b) => Math.abs(new Date(a.createdAt).getTime() - endBase) - Math.abs(new Date(b.createdAt).getTime() - endBase))[0] ?? null;
}

export function projectDecisionLogs(runs: any[], messages: any[]): AgentDecisionLog[] {
  const messagesById = new Map(messages.map((message) => [String(message.id), message]));
  return runs.map((run) => {
    const profile = record(run.profileSnapshot); const context = record(run.contextSnapshot);
    const trace = (run.traceLogs ?? []).find((item: any) => record(item.parsedResponse).assistantMessageId);
    const assistantId = text(record(trace?.parsedResponse).assistantMessageId);
    const exactAssistant = assistantId ? messagesById.get(assistantId) : null;
    const associatedAssistant = exactAssistant ?? legacyAssistant(run, messages);
    const legacyAssociation = !exactAssistant && Boolean(associatedAssistant);
    const evidence = (run.toolCalls ?? []).map((call: any) => {
      const summary = record(call.resultSummary);
      return {
        toolCallId: String(call.id),
        skillId: String(call.toolName),
        skillVersion: finite(summary.skillVersion),
        outputSchemaId: text(summary.outputSchemaId),
        routineVersions: routineVersions(summary.routineVersions),
        sourceProvider: text(summary.sourceProvider),
        sourceVenue: text(summary.sourceVenue) ?? text(call.venue),
        observedAt: text(summary.observedAt),
        fetchedAt: text(summary.fetchedAt),
        ageMs: finite(summary.ageMs),
        quality: quality(summary.quality, String(call.status)),
        durationMs: finite(call.durationMs),
        fallbackUsed: summary.fallbackUsed === true,
        warningCodes: Array.isArray(summary.warnings) ? summary.warnings.map(String).slice(0, 20) : []
      };
    });
    const reasonCodes = [...new Set([
      ...evidence.flatMap((item) => item.warningCodes),
      ...evidence.filter((item) => item.fallbackUsed).map(() => "market_data_fallback_used"),
      ...(legacyAssociation ? ["legacy_message_association"] : []),
      ...(run.errorCode ? [String(run.errorCode)] : [])
    ])];
    const states = evidence.map((item) => item.quality);
    const dataQuality: AgentDecisionLogQuality = run.status === "failed" || states.includes("unavailable") ? "unavailable" : states.includes("degraded") ? "degraded" : states.includes("stale") ? "stale" : "fresh";
    const completed = run.status === "completed";
    return {
      runId: String(run.id), state: String(run.status), createdAt: new Date(run.createdAt).toISOString(), completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      profile: { key: text(profile.baseProfileKey) ?? text(profile.key) ?? "market_analyst", name: text(profile.name) ?? "Market Analyst", version: finite(profile.version) ?? 1 },
      context: { symbol: text(context.symbol), marketType: context.marketType === "spot" || context.marketType === "perp" ? context.marketType as AgentMarketType : null, requestedVenue: (["auto", "binance", "bitget", "hyperliquid", "mexc", "bingx"].includes(String(context.selectedVenue)) ? context.selectedVenue : "auto") as AgentVenue },
      recommendation: completed && associatedAssistant ? { messageId: String(associatedAssistant.id), content: String(associatedAssistant.content ?? ""), blocks: validatedBlocks(associatedAssistant.blocks) } : null,
      evidence,
      dataQuality: { state: dataQuality, reasonCodes },
      modelClass: text(run.modelClass), totalLatencyMs: finite(run.latencyMs),
      permission: { readOnly: true, execution: "not_permitted" },
      technicalActivity: (run.toolCalls ?? []).map((call: any) => ({ id: String(call.id), skillId: String(call.toolName), status: String(call.status), venue: text(call.venue), durationMs: finite(call.durationMs), errorCode: text(call.errorCode) })),
      legacyAssociation
    };
  });
}
