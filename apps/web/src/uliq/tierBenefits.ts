export type UliqTierBenefitDraft = {
  code: string;
  subscriptionDiscountPercent: string;
  aiDiscountPercent: string;
  aiCreditDiscountMonthlyUsd: string;
};

export type UliqTierBenefitRequest = {
  reason: string;
  tiers: Array<{
    code: string;
    subscriptionDiscountBps: number;
    aiDiscountBps: number;
    aiCreditDiscountMonthlyCents: number | null;
  }>;
};

function formatScaledInteger(value: number, scale: number): string {
  if (!Number.isSafeInteger(value) || value < 0) return "";
  const divisor = 10 ** scale;
  const whole = Math.floor(value / divisor);
  const fraction = String(value % divisor).padStart(scale, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
function parseScaledInteger(value: string, scale: number, maximum: number): number {
  const normalized = value.trim().replace(",", ".");
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("uliq_tier_benefit_invalid_number");
  const fraction = (match[2] ?? "").padEnd(scale, "0");
  const result = Number(match[1]) * (10 ** scale) + Number(fraction || "0");
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum) {
    throw new Error("uliq_tier_benefit_invalid_number");
  }
  return result;
}

export function createUliqTierBenefitDraft(tier: {
  code: string;
  subscriptionDiscountBps: number;
  aiDiscountBps: number;
  monetaryBenefitCaps: { aiCreditDiscountMonthlyCents?: number | string } | null;
}): UliqTierBenefitDraft {
  const cap = tier.monetaryBenefitCaps?.aiCreditDiscountMonthlyCents;
  return {
    code: tier.code,
    subscriptionDiscountPercent: formatScaledInteger(tier.subscriptionDiscountBps, 2),
    aiDiscountPercent: formatScaledInteger(tier.aiDiscountBps, 2),
    aiCreditDiscountMonthlyUsd: cap == null ? "" : formatScaledInteger(Number(cap), 2)
  };
}

export function applyUliqBenefitPreset(
  drafts: UliqTierBenefitDraft[],
  preset: Array<{ code: string; subscriptionDiscountBps: number; aiDiscountBps: number }>
): UliqTierBenefitDraft[] {
  const byCode = new Map(preset.map((tier) => [tier.code, tier]));
  return drafts.map((draft) => {
    const tier = byCode.get(draft.code);
    return tier ? {
      ...draft,
      subscriptionDiscountPercent: formatScaledInteger(tier.subscriptionDiscountBps, 2),
      aiDiscountPercent: formatScaledInteger(tier.aiDiscountBps, 2)
    } : draft;
  });
}

export function buildUliqTierBenefitRequest(
  drafts: UliqTierBenefitDraft[],
  reason: string
): UliqTierBenefitRequest {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 8) throw new Error("uliq_tier_benefit_reason_required");
  if (drafts.length === 0 || new Set(drafts.map((draft) => draft.code)).size !== drafts.length) {
    throw new Error("uliq_tier_benefit_invalid_tiers");
  }
  return {
    reason: normalizedReason,
    tiers: drafts.map((draft) => {
      const subscriptionDiscountBps = parseScaledInteger(draft.subscriptionDiscountPercent, 2, 10_000);
      const aiDiscountBps = parseScaledInteger(draft.aiDiscountPercent, 2, 10_000);
      const capValue = draft.aiCreditDiscountMonthlyUsd.trim();
      const aiCreditDiscountMonthlyCents = capValue
        ? parseScaledInteger(capValue, 2, 2_147_483_647)
        : null;
      if (aiDiscountBps > 0 && (!aiCreditDiscountMonthlyCents || aiCreditDiscountMonthlyCents <= 0)) {
        throw new Error("uliq_tier_benefit_ai_cap_required");
      }
      return {
        code: draft.code,
        subscriptionDiscountBps,
        aiDiscountBps,
        aiCreditDiscountMonthlyCents
      };
    })
  };
}
