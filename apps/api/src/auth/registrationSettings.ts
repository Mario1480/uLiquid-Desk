import type { Express, Response } from "express";
import { z } from "zod";
import { getUserFromLocals, requireAuth } from "../auth.js";

export const REGISTRATION_SETTING_KEY = "auth.registration.v1";
const settingsSchema = z.object({ enabled: z.boolean() }).strict();

export async function readRegistrationSettings(db: any): Promise<{ enabled: boolean }> {
  const row = await db.globalSetting.findUnique({ where: { key: REGISTRATION_SETTING_KEY } });
  // Preserve existing installations until an administrator explicitly changes the setting.
  if (!row) return { enabled: true };
  const parsed = settingsSchema.safeParse(row.value);
  return { enabled: parsed.success && parsed.data.enabled };
}

export function registerRegistrationSettingsRoutes(app: Express, deps: {
  db: any;
  requireSuperadmin(res: Response): Promise<boolean>;
  recordAdminAuditEvent(input: any): Promise<void>;
}) {
  app.get("/auth/registration", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.json(await readRegistrationSettings(deps.db));
    } catch {
      return res.status(503).json({ error: "registration_unavailable" });
    }
  });
  app.get("/admin/settings/registration", requireAuth, async (_req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    res.setHeader("Cache-Control", "no-store");
    return res.json(await readRegistrationSettings(deps.db));
  });
  app.put("/admin/settings/registration", requireAuth, async (req, res) => {
    if (!(await deps.requireSuperadmin(res))) return;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload" });
    await deps.db.$transaction(async (tx: any) => {
      await tx.globalSetting.upsert({
        where: { key: REGISTRATION_SETTING_KEY },
        create: { key: REGISTRATION_SETTING_KEY, value: parsed.data },
        update: { value: parsed.data }
      });
      await deps.recordAdminAuditEvent({
        tx,
        actorUserId: getUserFromLocals(res).id,
        action: "admin.registration.updated",
        targetType: "global_setting",
        targetId: REGISTRATION_SETTING_KEY,
        metadata: parsed.data,
        ip: req.ip ?? null
      });
    });
    return res.json(parsed.data);
  });
}
