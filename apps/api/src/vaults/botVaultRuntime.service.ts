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
export type BotVaultV4Summary = BotVaultSummary;
export type BotVaultV4ActionFlags = BotVaultActionFlags;
export type BotVaultV4ExecutionReadiness = BotVaultExecutionReadiness;
export type BotVaultV4HealthSummary = BotVaultHealthSummary;
export type BotVaultV4Reconciliation = BotVaultReconciliation;
export type BotVaultV4ReconciliationIssue = BotVaultReconciliationIssue;

export function createBotVaultRuntimeService(
  ...args: Parameters<typeof createBotVaultV3Service>
) {
  const service = createBotVaultV3Service(...args);
  return {
    ...service,
    getBotVaultV4ForBot: service.getBotVaultForBot,
    ensureBotVaultV4ForBot: service.ensureBotVaultForBot,
    fundBotVaultV4: service.fundBotVault,
    reconcileBotVaultById: service.reconcileBotVaultV3ById,
    reconcileBotVaultV4ById: service.reconcileBotVaultV3ById
  };
}

export type BotVaultRuntimeService = ReturnType<typeof createBotVaultRuntimeService>;
export type BotVaultV4RuntimeService = BotVaultRuntimeService;

export function createBotVaultV4RuntimeService(
  ...args: Parameters<typeof createBotVaultV3Service>
): BotVaultRuntimeService {
  return createBotVaultRuntimeService(...args);
}

export const createBotVaultV4Service = createBotVaultV4RuntimeService;

export const buildBotVaultActionFlags = buildBotVaultV3ActionFlags;
export const buildBotVaultHealthSummary = buildBotVaultV3HealthSummary;
export const buildBotVaultResyncUpdate = buildBotVaultV3ResyncUpdate;
export const evaluateBotVaultExecutionReadiness = evaluateBotVaultV3ExecutionReadiness;
export const readBotVaultReconciliation = readBotVaultV3Reconciliation;
export const buildBotVaultV4ActionFlags = buildBotVaultActionFlags;
export const buildBotVaultV4HealthSummary = buildBotVaultHealthSummary;
export const buildBotVaultV4ResyncUpdate = buildBotVaultResyncUpdate;
export const evaluateBotVaultV4ExecutionReadiness = evaluateBotVaultExecutionReadiness;
export const readBotVaultV4Reconciliation = readBotVaultReconciliation;

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

export function reconcileBotVaultV4ById(
  service: BotVaultRuntimeService | BotVaultV3Service,
  params: Parameters<BotVaultV3Service["reconcileBotVaultV3ById"]>[0]
): ReturnType<BotVaultV3Service["reconcileBotVaultV3ById"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reconcileBotVaultV4ById === "function") {
    return runtimeService.reconcileBotVaultV4ById(params);
  }
  return reconcileBotVaultById(service, params);
}
