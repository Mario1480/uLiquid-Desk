export function shortAddress(value: string | null | undefined, size = 4): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not connected";
  if (raw.length <= size * 2 + 2) return raw;
  return `${raw.slice(0, size + 2)}…${raw.slice(-size)}`;
}

export function formatToken(value: string | number | null | undefined, decimals = 4): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(numeric);
}

export function formatUsd(value: string | number | null | undefined, decimals = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(numeric);
}

export function formatPct(value: string | number | null | undefined, decimals = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  }).format(numeric)}%`;
}

export function formatDateTime(value: string | number | null | undefined): string {
  const ts = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function buildExplorerAddressUrl(explorerUrl: string, address: string): string {
  return `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
}
