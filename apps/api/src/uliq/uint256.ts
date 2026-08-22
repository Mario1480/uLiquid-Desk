import { getAddress, isAddress } from "viem";

export const UINT256_MAX = (1n << 256n) - 1n;

export function parseUint256Decimal(value: unknown, field = "uint256"): bigint {
  const normalized = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) throw new Error(`invalid_${field}`);
  const parsed = BigInt(normalized);
  if (parsed > UINT256_MAX) throw new Error(`invalid_${field}`);
  return parsed;
}

export function uint256Decimal(value: unknown, field = "uint256"): string {
  return parseUint256Decimal(value, field).toString();
}

type FixedDecimalLike = {
  toFixed: () => string;
};

function isFixedDecimalLike(value: unknown): value is FixedDecimalLike {
  return Boolean(
    value
    && typeof value === "object"
    && "toFixed" in value
    && typeof (value as { toFixed?: unknown }).toFixed === "function"
  );
}

export function parseDatabaseUint256Decimal(value: unknown, field = "uint256"): bigint {
  const normalized = isFixedDecimalLike(value) ? value.toFixed() : value;
  return parseUint256Decimal(normalized, field);
}

export function databaseUint256Decimal(value: unknown, field = "uint256"): string {
  return parseDatabaseUint256Decimal(value, field).toString();
}

export function normalizeUliqAddress(value: unknown, field = "address"): `0x${string}` {
  const normalized = String(value ?? "").trim();
  if (!isAddress(normalized)) throw new Error(`invalid_${field}`);
  return getAddress(normalized);
}

export function parseDecimalToScale(value: unknown, scaleDigits = 18): bigint {
  const normalized = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("invalid_decimal");
  const fraction = String(match[2] ?? "");
  if (fraction.length > scaleDigits) throw new Error("decimal_precision_exceeded");
  return BigInt(match[1]) * 10n ** BigInt(scaleDigits)
    + BigInt((fraction + "0".repeat(scaleDigits)).slice(0, scaleDigits));
}

export function formatScaledDecimal(value: bigint, scaleDigits = 18): string {
  if (value < 0n) throw new Error("negative_decimal_not_supported");
  const scale = 10n ** BigInt(scaleDigits);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(scaleDigits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
