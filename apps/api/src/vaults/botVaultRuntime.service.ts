export * from "./botVaultV3.service.js";

import {
  buildBotVaultV3ActionFlags,
  buildBotVaultV3HealthSummary,
  buildBotVaultV3ResyncUpdate,
  createBotVaultV3Service,
  evaluateBotVaultV3ExecutionReadiness,
  readBotVaultV3Reconciliation,
  type BotVaultV3ActionFlags,
  type BotVaultV3ExecutionReadiness,
  type BotVaultV3HealthSummary,
  type BotVaultV3Reconciliation,
  type BotVaultV3ReconciliationIssue,
  type BotVaultV3Service,
  type BotVaultV3Summary
} from "./botVaultV3.service.js";

export type BotVaultSummary = BotVaultV3Summary;
export type BotVaultActionFlags = BotVaultV3ActionFlags;
export type BotVaultExecutionReadiness = BotVaultV3ExecutionReadiness;
export type BotVaultHealthSummary = BotVaultV3HealthSummary;
export type BotVaultReconciliation = BotVaultV3Reconciliation;
export type BotVaultReconciliationIssue = BotVaultV3ReconciliationIssue;

export function createBotVaultRuntimeService(
  ...args: Parameters<typeof createBotVaultV3Service>
) {
  const service = createBotVaultV3Service(...args);
  return {
    ...service,
    reconcileBotVaultById: service.reconcileBotVaultV3ById
  };
}

export type BotVaultRuntimeService = ReturnType<typeof createBotVaultRuntimeService>;

export const buildBotVaultActionFlags = buildBotVaultV3ActionFlags;
export const buildBotVaultHealthSummary = buildBotVaultV3HealthSummary;
export const buildBotVaultResyncUpdate = buildBotVaultV3ResyncUpdate;
export const evaluateBotVaultExecutionReadiness = evaluateBotVaultV3ExecutionReadiness;
export const readBotVaultReconciliation = readBotVaultV3Reconciliation;

export function reconcileBotVaultById(
  service: BotVaultRuntimeService | BotVaultV3Service,
  params: Parameters<BotVaultV3Service["reconcileBotVaultV3ById"]>[0]
): ReturnType<BotVaultV3Service["reconcileBotVaultV3ById"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reconcileBotVaultById === "function") {
    return runtimeService.reconcileBotVaultById(params);
  }
  return service.reconcileBotVaultV3ById(params);
}
