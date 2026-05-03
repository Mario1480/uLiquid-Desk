const DEFAULT_SUPERADMIN_EMAIL = "admin@uliquid.vip";

type SuperadminEnv = Partial<Record<"ADMIN_EMAIL" | "SUPERADMIN_EMAIL", string | undefined>>;

function parseEmailList(value: unknown): string[] {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function getConfiguredSuperadminEmails(env?: SuperadminEnv): string[] {
  const source = (env ?? process.env) as Record<string, string | undefined>;
  const adminEmails = parseEmailList(source.ADMIN_EMAIL);
  if (adminEmails.length > 0) return adminEmails;

  const legacyEmails = parseEmailList(source.SUPERADMIN_EMAIL);
  if (legacyEmails.length > 0) return legacyEmails;

  return [DEFAULT_SUPERADMIN_EMAIL];
}

export function getPrimarySuperadminEmail(env?: SuperadminEnv): string {
  return getConfiguredSuperadminEmails(env)[0] ?? DEFAULT_SUPERADMIN_EMAIL;
}

export function isSuperadminEmail(
  email: string | null | undefined,
  env?: SuperadminEnv
): boolean {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return getConfiguredSuperadminEmails(env).includes(normalized);
}
