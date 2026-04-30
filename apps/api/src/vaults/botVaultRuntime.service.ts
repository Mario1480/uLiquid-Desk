export * from "./botVaultV3.service.js";

import {
  buildBotVaultV3ActionFlags,
  buildBotVaultV3HealthSummary,
  buildBotVaultV3ResyncUpdate,
  createBotVaultV3Service,
  evaluateBotVaultV3ExecutionReadiness,
  readBotVaultV3Reconciliation,
  type BotVaultV3ActionFlags,
  type BotVaultV3ClaimProfitPreview,
  type BotVaultV3ClaimProfitResult,
  type BotVaultV3ControllerCloseResult,
  type BotVaultV3ControllerRecoverClosedResult,
  type BotVaultV3ExecutionReadiness,
  type BotVaultV3FinalizeMarginAddResult,
  type BotVaultV3HealthSummary,
  type BotVaultV3Reconciliation,
  type BotVaultV3ReconciliationIssue,
  type BotVaultV3ReduceMarginResult,
  type BotVaultV3Service,
  type BotVaultV3Summary
} from "./botVaultV3.service.js";

export type BotVaultSummary = BotVaultV3Summary;
export type BotVaultActionFlags = BotVaultV3ActionFlags;
export type BotVaultClaimProfitPreview = BotVaultV3ClaimProfitPreview;
export type BotVaultClaimProfitResult = BotVaultV3ClaimProfitResult;
export type BotVaultControllerCloseResult = BotVaultV3ControllerCloseResult;
export type BotVaultControllerRecoverClosedResult = BotVaultV3ControllerRecoverClosedResult;
export type BotVaultExecutionReadiness = BotVaultV3ExecutionReadiness;
export type BotVaultFinalizeMarginAddResult = BotVaultV3FinalizeMarginAddResult;
export type BotVaultHealthSummary = BotVaultV3HealthSummary;
export type BotVaultReconciliation = BotVaultV3Reconciliation;
export type BotVaultReconciliationIssue = BotVaultV3ReconciliationIssue;
export type BotVaultReduceMarginResult = BotVaultV3ReduceMarginResult;
export type BotVaultV4Summary = BotVaultSummary;
export type BotVaultV4ActionFlags = BotVaultActionFlags;
export type BotVaultV4ClaimProfitPreview = BotVaultClaimProfitPreview;
export type BotVaultV4ClaimProfitResult = BotVaultClaimProfitResult;
export type BotVaultV4ControllerCloseResult = BotVaultControllerCloseResult;
export type BotVaultV4ControllerRecoverClosedResult = BotVaultControllerRecoverClosedResult;
export type BotVaultV4ExecutionReadiness = BotVaultExecutionReadiness;
export type BotVaultV4FinalizeMarginAddResult = BotVaultFinalizeMarginAddResult;
export type BotVaultV4HealthSummary = BotVaultHealthSummary;
export type BotVaultV4Reconciliation = BotVaultReconciliation;
export type BotVaultV4ReconciliationIssue = BotVaultReconciliationIssue;
export type BotVaultV4ReduceMarginResult = BotVaultReduceMarginResult;

export function createBotVaultRuntimeService(
  ...args: Parameters<typeof createBotVaultV3Service>
) {
  const service = createBotVaultV3Service(...args);
  return {
    ...service,
    getBotVaultV4ForBot: service.getBotVaultForBot,
    ensureBotVaultV4ForBot: service.ensureBotVaultForBot,
    fundBotVaultForRuntime: service.fundBotVault,
    fundBotVaultV4: service.fundBotVault,
    previewBotVaultClaimProfit: service.previewClaimProfit,
    previewBotVaultV4ClaimProfit: service.previewClaimProfit,
    claimBotVaultProfit: service.claimProfit,
    claimBotVaultV4Profit: service.claimProfit,
    finalizeBotVaultMarginAdd: service.finalizeMarginAdd,
    finalizeBotVaultV4MarginAdd: service.finalizeMarginAdd,
    reduceBotVaultMargin: service.reduceMargin,
    reduceBotVaultV4Margin: service.reduceMargin,
    closeBotVaultOnchain: service.controllerCloseBotVault,
    closeBotVaultV4Onchain: service.controllerCloseBotVault,
    recoverBotVaultClosedFunds: service.controllerRecoverClosedBotVault,
    recoverBotVaultV4ClosedFunds: service.controllerRecoverClosedBotVault,
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

type BotVaultRuntimeOrLegacyService = BotVaultRuntimeService | BotVaultV3Service;

export function fundBotVaultForRuntime(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["fundBotVault"]>[0]
): ReturnType<BotVaultV3Service["fundBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.fundBotVaultForRuntime === "function") {
    return runtimeService.fundBotVaultForRuntime(params);
  }
  return service.fundBotVault(params);
}

export function fundBotVaultV4(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["fundBotVault"]>[0]
): ReturnType<BotVaultV3Service["fundBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.fundBotVaultV4 === "function") {
    return runtimeService.fundBotVaultV4(params);
  }
  return fundBotVaultForRuntime(service, params);
}

export function previewBotVaultClaimProfit(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["previewClaimProfit"]>[0]
): ReturnType<BotVaultV3Service["previewClaimProfit"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.previewBotVaultClaimProfit === "function") {
    return runtimeService.previewBotVaultClaimProfit(params);
  }
  return service.previewClaimProfit(params);
}

export function previewBotVaultV4ClaimProfit(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["previewClaimProfit"]>[0]
): ReturnType<BotVaultV3Service["previewClaimProfit"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.previewBotVaultV4ClaimProfit === "function") {
    return runtimeService.previewBotVaultV4ClaimProfit(params);
  }
  return previewBotVaultClaimProfit(service, params);
}

export function claimBotVaultProfit(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["claimProfit"]>[0]
): ReturnType<BotVaultV3Service["claimProfit"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.claimBotVaultProfit === "function") {
    return runtimeService.claimBotVaultProfit(params);
  }
  return service.claimProfit(params);
}

export function claimBotVaultV4Profit(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["claimProfit"]>[0]
): ReturnType<BotVaultV3Service["claimProfit"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.claimBotVaultV4Profit === "function") {
    return runtimeService.claimBotVaultV4Profit(params);
  }
  return claimBotVaultProfit(service, params);
}

export function finalizeBotVaultMarginAdd(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["finalizeMarginAdd"]>[0]
): ReturnType<BotVaultV3Service["finalizeMarginAdd"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.finalizeBotVaultMarginAdd === "function") {
    return runtimeService.finalizeBotVaultMarginAdd(params);
  }
  return service.finalizeMarginAdd(params);
}

export function finalizeBotVaultV4MarginAdd(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["finalizeMarginAdd"]>[0]
): ReturnType<BotVaultV3Service["finalizeMarginAdd"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.finalizeBotVaultV4MarginAdd === "function") {
    return runtimeService.finalizeBotVaultV4MarginAdd(params);
  }
  return finalizeBotVaultMarginAdd(service, params);
}

export function reduceBotVaultMargin(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["reduceMargin"]>[0]
): ReturnType<BotVaultV3Service["reduceMargin"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reduceBotVaultMargin === "function") {
    return runtimeService.reduceBotVaultMargin(params);
  }
  return service.reduceMargin(params);
}

export function reduceBotVaultV4Margin(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["reduceMargin"]>[0]
): ReturnType<BotVaultV3Service["reduceMargin"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reduceBotVaultV4Margin === "function") {
    return runtimeService.reduceBotVaultV4Margin(params);
  }
  return reduceBotVaultMargin(service, params);
}

export function closeBotVaultOnchain(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["controllerCloseBotVault"]>[0]
): ReturnType<BotVaultV3Service["controllerCloseBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.closeBotVaultOnchain === "function") {
    return runtimeService.closeBotVaultOnchain(params);
  }
  return service.controllerCloseBotVault(params);
}

export function closeBotVaultV4Onchain(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["controllerCloseBotVault"]>[0]
): ReturnType<BotVaultV3Service["controllerCloseBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.closeBotVaultV4Onchain === "function") {
    return runtimeService.closeBotVaultV4Onchain(params);
  }
  return closeBotVaultOnchain(service, params);
}

export function recoverBotVaultClosedFunds(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["controllerRecoverClosedBotVault"]>[0]
): ReturnType<BotVaultV3Service["controllerRecoverClosedBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.recoverBotVaultClosedFunds === "function") {
    return runtimeService.recoverBotVaultClosedFunds(params);
  }
  return service.controllerRecoverClosedBotVault(params);
}

export function recoverBotVaultV4ClosedFunds(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["controllerRecoverClosedBotVault"]>[0]
): ReturnType<BotVaultV3Service["controllerRecoverClosedBotVault"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.recoverBotVaultV4ClosedFunds === "function") {
    return runtimeService.recoverBotVaultV4ClosedFunds(params);
  }
  return recoverBotVaultClosedFunds(service, params);
}

export function reconcileBotVaultById(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["reconcileBotVaultV3ById"]>[0]
): ReturnType<BotVaultV3Service["reconcileBotVaultV3ById"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reconcileBotVaultById === "function") {
    return runtimeService.reconcileBotVaultById(params);
  }
  return service.reconcileBotVaultV3ById(params);
}

export function reconcileBotVaultV4ById(
  service: BotVaultRuntimeOrLegacyService,
  params: Parameters<BotVaultV3Service["reconcileBotVaultV3ById"]>[0]
): ReturnType<BotVaultV3Service["reconcileBotVaultV3ById"]> {
  const runtimeService = service as BotVaultRuntimeService;
  if (typeof runtimeService.reconcileBotVaultV4ById === "function") {
    return runtimeService.reconcileBotVaultV4ById(params);
  }
  return reconcileBotVaultById(service, params);
}
