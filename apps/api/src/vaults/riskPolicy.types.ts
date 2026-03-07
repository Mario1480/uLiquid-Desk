export type RiskPolicyErrorCode =
  | "risk_allocation_below_minimum"
  | "risk_allocation_above_maximum"
  | "risk_leverage_above_template_max"
  | "risk_symbol_not_allowed"
  | "risk_invalid_status_transition"
  | "risk_template_inactive"
  | "risk_template_not_found"
  | "risk_guardrail_emergency_pause_required";

export type RuntimeGuardrailAction = "none" | "pause" | "close_only" | "emergency_close";

export type RiskPolicyViolation = {
  code: RiskPolicyErrorCode;
  message: string;
  severity: "hard" | "soft";
  metadata?: Record<string, unknown>;
};

export type RiskPolicyStatus = "ACTIVE" | "PAUSED" | "STOPPED" | "CLOSE_ONLY" | "CLOSED" | "ERROR";

export type RuntimeGuardrailEvaluation = {
  breached: boolean;
  severity: "none" | "soft" | "hard";
  action: RuntimeGuardrailAction;
  violations: RiskPolicyViolation[];
};

export class RiskPolicyError extends Error {
  readonly code: RiskPolicyErrorCode;

  constructor(code: RiskPolicyErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RiskPolicyError";
    this.code = code;
  }
}

export type RiskTemplateSnapshot = {
  id: string;
  isActive: boolean;
  allowedSymbols: string[];
  minAllocationUsd: number;
  maxAllocationUsd: number;
  maxLeverage: number;
};

export type AssertCreateBotVaultInput = {
  tx?: any;
  templateId: string;
  symbol: string;
  leverage: number;
  allocationUsd: number;
};

export type AssertTopUpBotVaultInput = {
  tx?: any;
  templateId: string;
  symbol: string;
  leverage: number;
  resultingAllocationUsd: number;
};

export type AssertStartOrResumeInput = {
  tx?: any;
  templateId: string;
  symbol: string;
  leverage: number;
};

export type AssertStatusTransitionInput = {
  fromStatus: string;
  toStatus: string;
  forceClose?: boolean;
};

export type EvaluateRuntimeGuardrailsInput = {
  tx?: any;
  templateId: string;
  symbol: string;
  leverage: number;
  allocationUsd: number;
};
