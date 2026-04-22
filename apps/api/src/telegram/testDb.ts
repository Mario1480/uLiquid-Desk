type TestUser = {
  id: string;
  telegramChatId: string | null;
};

type TestSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  consumedAt: Date | null;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TestAlertConfig = {
  key: string;
  telegramChatId: string | null;
  telegramBotToken: string | null;
};

type CreateTelegramTestDbInput = {
  users?: TestUser[];
  sessions?: TestSession[];
  alertConfig?: Partial<TestAlertConfig> | null;
};

function selectFields<T extends Record<string, any>>(row: T | null | undefined, select?: Record<string, boolean>) {
  if (!row) return null;
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = row[key];
  }
  return out;
}

let sessionCounter = 0;

export function createTelegramTestDb(input: CreateTelegramTestDbInput = {}) {
  const state = {
    users: (input.users ?? []).map((row) => ({ ...row })),
    sessions: (input.sessions ?? []).map((row) => ({ ...row })),
    alertConfig: {
      key: "default",
      telegramChatId: null,
      telegramBotToken: "bot-token",
      ...(input.alertConfig ?? {})
    } satisfies TestAlertConfig
  };

  const tx = {
    user: {
      async findUnique(args: any) {
        const row = state.users.find((entry) => entry.id === args.where.id) ?? null;
        return selectFields(row, args.select);
      },
      async findFirst(args: any) {
        const idNot = args.where?.id?.not ?? null;
        const chatId = args.where?.telegramChatId ?? null;
        const row = state.users.find((entry) => (
          entry.telegramChatId === chatId
          && (idNot ? entry.id !== idNot : true)
        )) ?? null;
        return selectFields(row, args.select);
      },
      async update(args: any) {
        const row = state.users.find((entry) => entry.id === args.where.id);
        if (!row) throw new Error("user_not_found");
        row.telegramChatId = Object.prototype.hasOwnProperty.call(args.data, "telegramChatId")
          ? (args.data.telegramChatId ?? null)
          : row.telegramChatId;
        return selectFields(row, args.select);
      }
    },
    alertConfig: {
      async findUnique(args: any) {
        if (args.where?.key !== "default") return null;
        return selectFields(state.alertConfig, args.select);
      }
    },
    telegramLinkSession: {
      async create(args: any) {
        const row: TestSession = {
          id: `session_${++sessionCounter}`,
          userId: args.data.userId,
          token: args.data.token,
          expiresAt: new Date(args.data.expiresAt),
          consumedAt: args.data.consumedAt ?? null,
          telegramChatId: args.data.telegramChatId ?? null,
          telegramUserId: args.data.telegramUserId ?? null,
          telegramUsername: args.data.telegramUsername ?? null,
          createdAt: args.data.createdAt ?? new Date(),
          updatedAt: args.data.updatedAt ?? new Date()
        };
        state.sessions.push(row);
        return { ...row };
      },
      async findFirst(args: any) {
        const nowGt = args.where?.expiresAt?.gt ?? null;
        const rows = state.sessions
          .filter((row) => (
            row.userId === args.where?.userId
            && row.consumedAt === args.where?.consumedAt
            && (!nowGt || row.expiresAt.getTime() > nowGt.getTime())
          ))
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        return selectFields(rows[0] ?? null, args.select);
      },
      async findUnique(args: any) {
        const row = state.sessions.find((entry) => entry.token === args.where.token || entry.id === args.where.id) ?? null;
        return selectFields(row, args.select);
      },
      async update(args: any) {
        const row = state.sessions.find((entry) => entry.id === args.where.id);
        if (!row) throw new Error("session_not_found");
        if (Object.prototype.hasOwnProperty.call(args.data, "expiresAt")) row.expiresAt = new Date(args.data.expiresAt);
        if (Object.prototype.hasOwnProperty.call(args.data, "consumedAt")) row.consumedAt = args.data.consumedAt ? new Date(args.data.consumedAt) : null;
        if (Object.prototype.hasOwnProperty.call(args.data, "telegramChatId")) row.telegramChatId = args.data.telegramChatId ?? null;
        if (Object.prototype.hasOwnProperty.call(args.data, "telegramUserId")) row.telegramUserId = args.data.telegramUserId ?? null;
        if (Object.prototype.hasOwnProperty.call(args.data, "telegramUsername")) row.telegramUsername = args.data.telegramUsername ?? null;
        row.updatedAt = new Date();
        return { ...row };
      },
      async updateMany(args: any) {
        let count = 0;
        for (const row of state.sessions) {
          const matches = (
            row.userId === args.where?.userId
            && (args.where?.consumedAt === undefined || row.consumedAt === args.where.consumedAt)
            && (!args.where?.id?.not || row.id !== args.where.id.not)
            && (!args.where?.expiresAt?.gt || row.expiresAt.getTime() > args.where.expiresAt.gt.getTime())
          );
          if (!matches) continue;
          if (Object.prototype.hasOwnProperty.call(args.data, "expiresAt")) row.expiresAt = new Date(args.data.expiresAt);
          if (Object.prototype.hasOwnProperty.call(args.data, "consumedAt")) row.consumedAt = args.data.consumedAt ? new Date(args.data.consumedAt) : null;
          row.updatedAt = new Date();
          count += 1;
        }
        return { count };
      }
    }
  };

  return {
    ...tx,
    $transaction<T>(fn: (tx: typeof tx) => Promise<T>): Promise<T> {
      return fn(tx);
    },
    state
  };
}
