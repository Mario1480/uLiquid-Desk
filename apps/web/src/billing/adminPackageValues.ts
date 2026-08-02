const BILLING_DB_BIGINT_MAX = BigInt("9223372036854775807");
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

export function normalizeNonNegativeBillingInteger(value: string): string {
  const normalized = value.trim();
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(normalized)) {
    throw new Error("billing_integer_invalid");
  }
  const parsed = BigInt(normalized);
  if (parsed > BILLING_DB_BIGINT_MAX) {
    throw new Error("billing_integer_out_of_range");
  }
  return parsed.toString();
}
