import { decryptSecret } from "../../../../secret-crypto.js";

export async function resolveLegacyFmpApiKey(db: any): Promise<string | null> {
  const envKey = String(process.env.FMP_API_KEY ?? "").trim();
  if (envKey) return envKey;
  try {
    const row = await db?.globalSetting?.findUnique?.({
      where: { key: "admin.apiKeys" },
      select: { value: true }
    });
    const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? row.value as Record<string, unknown>
      : {};
    const encrypted = typeof value.fmpApiKeyEnc === "string" ? value.fmpApiKeyEnc.trim() : "";
    if (!encrypted) return null;
    const decrypted = decryptSecret(encrypted).trim();
    return decrypted || null;
  } catch {
    return null;
  }
}
