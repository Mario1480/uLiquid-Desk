export const AI_MODEL_ROUTING = {
  utility: {
    model: "gpt-5-nano",
    reasoningEffort: "minimal",
    maxOutputTokens: 1_000,
    maxToolRounds: 0
  },
  standard: {
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    maxOutputTokens: 6_000,
    maxToolRounds: 5
  },
  analysis: {
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    maxOutputTokens: 10_000,
    maxToolRounds: 8
  },
  deep: {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    maxOutputTokens: 16_000,
    maxToolRounds: 10
  }
} as const;
