function normalizeTone(value: string): string {
  const tone = value.trim().toLowerCase();
  if (["accepted", "active", "online", "running", "resolved", "healthy", "verified", "completed", "finalized"].includes(tone)) return "success";
  if (["critical", "error", "expired", "offline", "failed", "missing", "suspended", "reorged", "review required"].includes(tone)) return "danger";
  if (["acknowledged", "expiring soon", "expiring_soon", "attention", "high", "idle", "degraded", "submitted", "soft confirmed", "safe"].includes(tone)) return "warning";
  return "neutral";
}

export default function AdminStatusBadge({
  value,
  label
}: {
  value: string | null | undefined;
  label?: string;
}) {
  const safeValue = String(value ?? "unknown").replace(/_/g, " ");
  return <span className={`tag adminStatusBadge adminStatusBadge${normalizeTone(safeValue)}`}>{label ?? safeValue}</span>;
}
