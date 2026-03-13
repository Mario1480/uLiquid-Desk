export async function loadBotVaultByInstanceIds(db: any, instanceIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!instanceIds.length) return map;
  const botVaultModel = db?.botVault;
  if (!botVaultModel || typeof botVaultModel.findMany !== "function") return map;
  try {
    const rows = await botVaultModel.findMany({
      where: {
        gridInstanceId: {
          in: instanceIds
        }
      }
    });
    for (const row of rows) {
      const key = String(row?.gridInstanceId ?? "");
      if (!key) continue;
      map.set(key, row);
    }
  } catch {
    // Optional compatibility fallback: older Prisma clients may not expose BotVault yet.
  }
  return map;
}

export async function loadGridInstanceForUser(params: {
  db: any;
  userId: string;
  instanceId: string;
}) {
  const row = await params.db.gridBotInstance.findFirst({
    where: {
      id: params.instanceId,
      userId: params.userId
    },
    include: {
      template: true,
      bot: {
        include: {
          futuresConfig: true,
          exchangeAccount: {
            select: {
              id: true,
              exchange: true,
              label: true
            }
          }
        }
      }
    }
  });
  if (!row) return row;
  const vaultByInstanceId = await loadBotVaultByInstanceIds(params.db, [row.id]);
  return {
    ...row,
    botVault: vaultByInstanceId.get(row.id) ?? null
  };
}
