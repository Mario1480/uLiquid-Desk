export function isUliqPublicPresaleWebEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_ENABLED
): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function isUliqPublicPresaleAdminVisible(
  value: string | undefined = process.env.NEXT_PUBLIC_ULIQ_ADMIN_VISIBLE
): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export function isUliqPublicPresaleLiveDataEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_ULIQ_PUBLIC_PRESALE_LIVE_DATA_ENABLED
): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
