import {
  RiskPolicyError,
  type AssertCreateBotVaultInput,
  type AssertStartOrResumeInput,
  type AssertStatusTransitionInput,
  type AssertTopUpBotVaultInput,
  type EvaluateRuntimeGuardrailsInput,
  type RiskPolicyStatus,
  type RiskPolicyViolation,
  type RiskTemplateSnapshot,
  type RuntimeGuardrailEvaluation
} from "./riskPolicy.types.js";

const DEFAULT_MIN_ALLOCATION_USD = 0.01;
const DEFAULT_MAX_ALLOCATION_USD = 1_000_000;
const DEFAULT_MAX_LEVERAGE = 125;

function normalizeTemplateId(value: unknown): string {
  const templateId = String(value ?? "").trim();
  return templateId || "legacy_grid_default";
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeLeverage(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function normalizeAllocation(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeStatus(value: unknown): RiskPolicyStatus {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "PAUSED") return "PAUSED";
  if (raw === "STOPPED") return "STOPPED";
  if (raw === "CLOSE_ONLY") return "CLOSE_ONLY";
  if (raw === "CLOSED") return "CLOSED";
  if (raw === "ERROR") return "ERROR";
  return "ACTIVE";
}

function canonicalFromStatus(value: unknown): RiskPolicyStatus {
  const normalized = normalizeStatus(value);
  if (normalized === "STOPPED") return "PAUSED";
  return normalized;
}

function allowedTransition(params: {
  fromStatus: RiskPolicyStatus;
  toStatus: RiskPolicyStatus;
  forceClose: boolean;
}): boolean {
  if (params.fromStatus === params.toStatus) return true;
  if (params.fromStatus === "CLOSED") return false;

  if (params.fromStatus === "ACTIVE") {
    return params.toStatus === "PAUSED" || params.toStatus === "CLOSE_ONLY";
  }

  if (params.fromStatus === "PAUSED") {
    return params.toStatus === "ACTIVE" || params.toStatus === "CLOSE_ONLY";
  }

  if (params.fromStatus === "CLOSE_ONLY") {
    return params.toStatus === "CLOSED";
  }

  if (params.fromStatus === "ERROR") {
    if (params.toStatus === "CLOSE_ONLY") return true;
    if (params.toStatus === "CLOSED") return params.forceClose;
    return false;
  }

  return false;
}

function normalizeTemplate(row: any): RiskTemplateSnapshot {
  const allowedSymbols = Array.isArray(row?.allowedSymbols)
    ? row.allowedSymbols.map((entry: unknown) => normalizeSymbol(entry)).filter(Boolean)
    : [];

  return {
    id: String(row.id),
    isActive: Boolean(row?.isActive ?? true),
    allowedSymbols,
    minAllocationUsd: Math.max(DEFAULT_MIN_ALLOCATION_USD, Number(row?.minAllocationUsd ?? DEFAULT_MIN_ALLOCATION_USD)),
    maxAllocationUsd: Math.max(
      Number(row?.minAllocationUsd ?? DEFAULT_MIN_ALLOCATION_USD),
      Number(row?.maxAllocationUsd ?? DEFAULT_MAX_ALLOCATION_USD)
    ),
    maxLeverage: Math.max(1, Math.trunc(Number(row?.maxLeverage ?? DEFAULT_MAX_LEVERAGE)))
  };
}

function assertTemplateActive(template: RiskTemplateSnapshot) {
  if (!template.isActive) {
    throw new RiskPolicyError("risk_template_inactive", "risk_template_inactive");
  }
}

function assertSymbolAllowed(params: {
  template: RiskTemplateSnapshot;
  symbol: string;
}) {
  if (params.template.allowedSymbols.length === 0) return;
  const symbol = normalizeSymbol(params.symbol);
  if (!params.template.allowedSymbols.includes(symbol)) {
    throw new RiskPolicyError("risk_symbol_not_allowed", "risk_symbol_not_allowed");
  }
}

function assertLeverageAllowed(params: {
  template: RiskTemplateSnapshot;
  leverage: number;
}) {
  if (params.leverage <= params.template.maxLeverage + 0.0000001) return;
  throw new RiskPolicyError("risk_leverage_above_template_max", "risk_leverage_above_template_max");
}

function assertAllocationInRange(params: {
  template: RiskTemplateSnapshot;
  allocationUsd: number;
}) {
  if (params.allocationUsd < params.template.minAllocationUsd - 0.0000001) {
    throw new RiskPolicyError("risk_allocation_below_minimum", "risk_allocation_below_minimum");
  }
  if (params.allocationUsd > params.template.maxAllocationUsd + 0.0000001) {
    throw new RiskPolicyError("risk_allocation_above_maximum", "risk_allocation_above_maximum");
  }
}

export function createRiskPolicyService(db: any) {
  async function resolveTemplate(params: {
    tx?: any;
    templateId: string;
  }): Promise<RiskTemplateSnapshot | null> {
    const tx = params.tx ?? db;
    const templateId = normalizeTemplateId(params.templateId);

    if (!tx?.botTemplate?.findUnique) return null;

    const select = {
      id: true,
      isActive: true,
      allowedSymbols: true,
      minAllocationUsd: true,
      maxAllocationUsd: true,
      maxLeverage: true
    };

    const row = await tx.botTemplate.findUnique({
      where: { id: templateId },
      select
    });
    if (row) return normalizeTemplate(row);

    if (templateId !== "legacy_grid_default") {
      const fallback = await tx.botTemplate.findUnique({
        where: { id: "legacy_grid_default" },
        select
      });
      if (fallback) return normalizeTemplate(fallback);
    }

    return null;
  }

  async function resolveTemplateOrThrow(params: {
    tx?: any;
    templateId: string;
  }): Promise<RiskTemplateSnapshot> {
    const template = await resolveTemplate(params);
    if (!template) {
      throw new RiskPolicyError("risk_template_not_found", "risk_template_not_found");
    }
    return template;
  }

  async function assertCanCreateBotVault(input: AssertCreateBotVaultInput): Promise<void> {
    const template = await resolveTemplateOrThrow({
      tx: input.tx,
      templateId: input.templateId
    });

    assertTemplateActive(template);
    assertAllocationInRange({
      template,
      allocationUsd: normalizeAllocation(input.allocationUsd)
    });
    assertLeverageAllowed({
      template,
      leverage: normalizeLeverage(input.leverage)
    });
    assertSymbolAllowed({
      template,
      symbol: input.symbol
    });
  }

  async function assertCanTopUpBotVault(input: AssertTopUpBotVaultInput): Promise<void> {
    const template = await resolveTemplateOrThrow({
      tx: input.tx,
      templateId: input.templateId
    });

    assertTemplateActive(template);
    assertAllocationInRange({
      template,
      allocationUsd: normalizeAllocation(input.resultingAllocationUsd)
    });
    assertLeverageAllowed({
      template,
      leverage: normalizeLeverage(input.leverage)
    });
    assertSymbolAllowed({
      template,
      symbol: input.symbol
    });
  }

  async function assertCanStartOrResume(input: AssertStartOrResumeInput): Promise<void> {
    const template = await resolveTemplateOrThrow({
      tx: input.tx,
      templateId: input.templateId
    });

    assertTemplateActive(template);
    assertLeverageAllowed({
      template,
      leverage: normalizeLeverage(input.leverage)
    });
    assertSymbolAllowed({
      template,
      symbol: input.symbol
    });
  }

  function assertStatusTransition(input: AssertStatusTransitionInput): void {
    const fromStatus = canonicalFromStatus(input.fromStatus);
    const toStatus = canonicalFromStatus(input.toStatus);
    const forceClose = input.forceClose === true;

    if (!allowedTransition({ fromStatus, toStatus, forceClose })) {
      throw new RiskPolicyError("risk_invalid_status_transition", "risk_invalid_status_transition");
    }
  }

  async function evaluateRuntimeGuardrails(input: EvaluateRuntimeGuardrailsInput): Promise<RuntimeGuardrailEvaluation> {
    const template = await resolveTemplateOrThrow({
      tx: input.tx,
      templateId: input.templateId
    });

    const violations: RiskPolicyViolation[] = [];
    const leverage = normalizeLeverage(input.leverage);
    const allocationUsd = normalizeAllocation(input.allocationUsd);
    const symbol = normalizeSymbol(input.symbol);

    if (!template.isActive) {
      violations.push({
        code: "risk_template_inactive",
        message: "risk_template_inactive",
        severity: "hard"
      });
    }

    if (leverage > template.maxLeverage + 0.0000001) {
      violations.push({
        code: "risk_leverage_above_template_max",
        message: "risk_leverage_above_template_max",
        severity: "hard",
        metadata: {
          leverage,
          maxLeverage: template.maxLeverage
        }
      });
    }

    if (template.allowedSymbols.length > 0 && !template.allowedSymbols.includes(symbol)) {
      violations.push({
        code: "risk_symbol_not_allowed",
        message: "risk_symbol_not_allowed",
        severity: "hard",
        metadata: {
          symbol,
          allowedSymbols: template.allowedSymbols
        }
      });
    }

    if (allocationUsd < template.minAllocationUsd - 0.0000001) {
      violations.push({
        code: "risk_allocation_below_minimum",
        message: "risk_allocation_below_minimum",
        severity: "soft",
        metadata: {
          allocationUsd,
          minAllocationUsd: template.minAllocationUsd
        }
      });
    }

    if (allocationUsd > template.maxAllocationUsd + 0.0000001) {
      violations.push({
        code: "risk_allocation_above_maximum",
        message: "risk_allocation_above_maximum",
        severity: "soft",
        metadata: {
          allocationUsd,
          maxAllocationUsd: template.maxAllocationUsd
        }
      });
    }

    const hasHard = violations.some((entry) => entry.severity === "hard");
    const hasSoft = violations.some((entry) => entry.severity === "soft");

    if (hasHard) {
      violations.unshift({
        code: "risk_guardrail_emergency_pause_required",
        message: "risk_guardrail_emergency_pause_required",
        severity: "hard"
      });
      return {
        breached: true,
        severity: "hard",
        action: "pause",
        violations
      };
    }

    if (hasSoft) {
      return {
        breached: true,
        severity: "soft",
        action: "none",
        violations
      };
    }

    return {
      breached: false,
      severity: "none",
      action: "none",
      violations: []
    };
  }

  return {
    resolveTemplate,
    assertCanCreateBotVault,
    assertCanTopUpBotVault,
    assertCanStartOrResume,
    assertStatusTransition,
    evaluateRuntimeGuardrails
  };
}

export type RiskPolicyService = ReturnType<typeof createRiskPolicyService>;
