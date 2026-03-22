function normalizeTone(value: string): string {
  const tone = value.trim().toLowerCase();
  if (["active", "online", "running", "resolved"].includes(tone)) return "success";
  if (["critical", "error", "expired", "offline", "failed"].includes(tone)) return "danger";
  if (["acknowledged", "expiring_soon", "attention", "high", "idle"].includes(tone)) return "warning";
  return "neutral";
}

export default function AdminStatusBadge({ value }: { value: string | null | undefined }) {
  const safeValue = String(value ?? "unknown").replace(/_/g, " ");
  return <span className={`tag adminStatusBadge adminStatusBadge${normalizeTone(safeValue)}`}>{safeValue}</span>;
}
