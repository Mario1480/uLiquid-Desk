import { DERIVATIVES_HISTORY_ROUTINE_ID, derivativesHistoryOutputSchema } from "../routines/derivativesHistory.js";

// Model-only presentation: persisted evidence and its numeric timestamps stay unchanged.
export function serializeMarketModelPayload(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) => {
    if (!value || typeof value !== "object" || value.routineId !== DERIVATIVES_HISTORY_ROUTINE_ID) return value;
    const history = derivativesHistoryOutputSchema.parse(value);
    const utc = (timestamp: number | null) => timestamp === null ? null : new Date(timestamp).toISOString();
    return { ...history,
      requestedStart: utc(history.requestedStart), requestedEnd: utc(history.requestedEnd),
      actualStart: utc(history.actualStart), actualEnd: utc(history.actualEnd)
    };
  });
}
