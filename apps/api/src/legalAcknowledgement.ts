import crypto from "node:crypto";

export const LEGAL_ACKNOWLEDGEMENT_VERSION = "2026-05-17";

export const LEGAL_ACKNOWLEDGEMENT_COPY = [
  "By creating an account or using uLiquid, you agree to the uLiquid Terms of Use, acknowledge the uLiquid Privacy Policy, and acknowledge the uLiquid Crypto Risk Disclosure.",
  "uLiquid is non-custodial software. uLiquid does not take custody of your funds and has no independent access to withdraw your funds. uLiquid does not ask for or control your private keys, seed phrases, or withdrawal credentials. Wallets, exchange accounts, API permissions, smart contracts, orders, and transactions remain under your control or the third-party venues you choose.",
  "uLiquid does not provide financial, investment, trading, tax, accounting, or legal advice. Information, signals, automation, alerts, backtests, forecasts, and examples are provided for software functionality and informational purposes only.",
  "Crypto-assets, derivatives, leverage, automated trading, exchange integrations, smart contracts, wallets, and network activity involve substantial risk. You may lose some or all of your funds.",
  "You are solely responsible for every wallet connection, API permission, order, strategy, bot, configuration, deposit, withdrawal, transfer, and transaction initiated through or alongside uLiquid.",
  "Past performance, backtests, simulated results, AI outputs, indicators, and strategy presets do not guarantee future results. uLiquid makes no promise of profit, availability, execution quality, or error-free operation.",
  "By using uLiquid, you confirm that you understand these risks and use the software entirely at your own risk."
].join("\n");

export const LEGAL_ACKNOWLEDGEMENT_TEXT_HASH = crypto
  .createHash("sha256")
  .update(LEGAL_ACKNOWLEDGEMENT_COPY)
  .digest("hex");

function firstHeaderValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

function sanitizeMetaValue(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

export function readLegalAcknowledgementRequestMeta(req: {
  ip?: unknown;
  headers?: Record<string, unknown>;
}): { ipAddress: string | null; userAgent: string | null } {
  const forwardedFor = firstHeaderValue(req.headers?.["x-forwarded-for"]).split(",")[0]?.trim() ?? "";
  const ipAddress = sanitizeMetaValue(req.ip, 128) ?? sanitizeMetaValue(forwardedFor, 128);
  const userAgent = sanitizeMetaValue(firstHeaderValue(req.headers?.["user-agent"]), 512);
  return { ipAddress, userAgent };
}
