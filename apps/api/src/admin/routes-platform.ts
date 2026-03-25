import express from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import {
  getPlatformAlertRetentionSettings,
  PLATFORM_ALERT_RETENTION_DAYS,
  resolvePlatformAlertRetentionCutoff,
  setPlatformAlertRetentionSettings
} from "./platformAlertRetention.js";

const sortDirSchema = z.enum(["asc", "desc"]).catch("desc");

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(200).optional().catch(""),
  sortBy: z.string().trim().max(64).optional(),
  sortDir: sortDirSchema.optional()
});

const usersQuerySchema = pagingSchema.extend({
  status: z.string().trim().optional(),
  role: z.string().trim().optional(),
  licenseStatus: z.string().trim().optional()
});

const workspacesQuerySchema = pagingSchema.extend({
  status: z.string().trim().optional(),
  licenseStatus: z.string().trim().optional()
});

const licensesQuerySchema = pagingSchema.extend({
  status: z.string().trim().optional()
});

const alertsQuerySchema = pagingSchema.extend({
  severity: z.string().trim().optional(),
  status: z.string().trim().optional(),
  type: z.string().trim().optional(),
  source: z.string().trim().optional()
});

const botsQuerySchema = pagingSchema.extend({
  status: z.string().trim().optional(),
  exchange: z.string().trim().optional(),
  symbol: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  runnerId: z.string().trim().optional(),
  strategyType: z.string().trim().optional()
});

const runnersQuerySchema = pagingSchema.extend({
  status: z.string().trim().optional()
});

const auditQuerySchema = pagingSchema.extend({
  actorId: z.string().trim().optional(),
  action: z.string().trim().optional(),
  targetType: z.string().trim().optional(),
  workspaceId: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional()
});

const statisticsQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).catch("30d")
});

const alertStatusMutationSchema = z.object({
  status: z.enum(["acknowledged", "resolved"])
});

const alertRetentionMutationSchema = z.object({
  autoDeleteOlderThan30Days: z.boolean()
});

const alertDeleteMutationSchema = z.object({
  scope: z.enum(["all", "older_than_30_days"])
});

type RegisterPlatformAdminRoutesDeps = {
  db: any;
  requirePlatformSuperadmin(res: express.Response): Promise<boolean>;
  recordAdminAuditEvent(input: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetLabel?: string | null;
    workspaceId?: string | null;
    metadata?: Record<string, unknown> | null;
    ip?: string | null;
  }): Promise<void>;
  readUserFromLocals(res: express.Response): { id: string; email: string };
  isSuperadminEmail(email: string): boolean;
  getAdminBackendAccessUserIdSet(): Promise<Set<string>>;
  getAccessSectionSettings(): Promise<any>;
  getServerInfoSettings(): Promise<any>;
  getBillingFeatureFlagsSettings(): Promise<any>;
};

type PaginationResult = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function pagination(page: number, pageSize: number, total: number): PaginationResult {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nameFromEmail(email: string | null | undefined): string {
  const value = String(email ?? "").trim();
  if (!value) return "Unknown";
  return value.split("@")[0] || value;
}

function toUserStatus(lastActiveAt: string | null, lastLoginAt: string | null): "active" | "idle" | "never_logged_in" {
  if (!lastLoginAt) return "never_logged_in";
  if (!lastActiveAt) return "idle";
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  return diff <= 1000 * 60 * 60 * 24 * 30 ? "active" : "idle";
}

function normalizeRoleSummary(input: {
  isSuperadmin: boolean;
  memberships: Array<{ role?: { name?: string | null } | null }>;
}): string {
  if (input.isSuperadmin) return "Superadmin";
  const names = [...new Set(
    (input.memberships ?? [])
      .map((membership) => String(membership?.role?.name ?? "").trim())
      .filter(Boolean)
  )];
  if (names.length === 0) return "None";
  if (names.length === 1) return names[0];
  return "Mixed";
}

function deriveLicenseStatus(input: {
  effectivePlan?: string | null;
  status?: string | null;
  proValidUntil?: string | null;
  verificationStatus?: string | null;
}): "active" | "expiring_soon" | "expired" | "inactive" | "verification_failed" {
  if (String(input.verificationStatus ?? "").toLowerCase() === "failed") return "verification_failed";
  const rawStatus = String(input.status ?? "").toUpperCase();
  const expiresAt = input.proValidUntil ? new Date(input.proValidUntil) : null;
  const now = Date.now();
  if (expiresAt && !Number.isNaN(expiresAt.getTime())) {
    if (expiresAt.getTime() < now) return "expired";
    if (expiresAt.getTime() - now <= 1000 * 60 * 60 * 24 * 14) return "expiring_soon";
  }
  if (rawStatus === "ACTIVE" || String(input.effectivePlan ?? "").toUpperCase() !== "FREE") return "active";
  return "inactive";
}

function derivePlatformAlertStatus(alert: any): "open" | "acknowledged" | "resolved" {
  const status = String(alert?.status ?? "").toLowerCase();
  if (status === "resolved") return "resolved";
  if (status === "acknowledged") return "acknowledged";
  return "open";
}

function deriveRunnerStatus(lastHeartbeatAt: string | null): "online" | "offline" {
  if (!lastHeartbeatAt) return "offline";
  const diff = Date.now() - new Date(lastHeartbeatAt).getTime();
  return diff <= 1000 * 60 * 5 ? "online" : "offline";
}

type RunnerNodeLike = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  lastHeartbeatAt?: unknown;
  metadata?: unknown;
};

type RunnerRuntimeLike = {
  workerId?: unknown;
  status?: unknown;
  lastHeartbeatAt?: unknown;
  lastTickAt?: unknown;
  updatedAt?: unknown;
};

function isMainRunnerNode(node: RunnerNodeLike): boolean {
  const id = String(node.id ?? "").trim().toLowerCase();
  const name = String(node.name ?? "").trim().toLowerCase();
  return id === "main" || id === "main_runner" || name === "main runner";
}

function resolveRunnerRuntimeLastSeenAt(runtime: RunnerRuntimeLike): string | null {
  const values = [
    isoOrNull(runtime.lastHeartbeatAt),
    isoOrNull(runtime.lastTickAt),
    isoOrNull(runtime.updatedAt)
  ].filter((value): value is string => Boolean(value));
  if (values.length === 0) return null;
  return values
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString() ?? null;
}

function mapRuntimesToRunnerIds(
  runnerNodes: RunnerNodeLike[],
  runtimes: RunnerRuntimeLike[]
): Map<string, RunnerRuntimeLike[]> {
  const out = new Map<string, RunnerRuntimeLike[]>();
  const runnerIds = new Set(
    runnerNodes.map((row) => String(row.id ?? "").trim()).filter(Boolean)
  );
  const mainRunnerId =
    runnerNodes
      .map((row) => String(row.id ?? "").trim())
      .find((id, index) => Boolean(id) && isMainRunnerNode(runnerNodes[index]!))
    ?? (runnerNodes.length === 1 ? String(runnerNodes[0]?.id ?? "").trim() : "");

  for (const runtime of runtimes) {
    const workerId = String(runtime.workerId ?? "").trim();
    const targetRunnerId =
      workerId && runnerIds.has(workerId)
        ? workerId
        : mainRunnerId;
    if (!targetRunnerId) continue;
    const current = out.get(targetRunnerId) ?? [];
    current.push(runtime);
    out.set(targetRunnerId, current);
  }

  return out;
}

function deriveRunnerStatusFromSignals(
  runnerNode: RunnerNodeLike,
  runtimes: RunnerRuntimeLike[]
): { status: "online" | "offline"; lastHeartbeatAt: string | null } {
  const nodeHeartbeatAt = isoOrNull(runnerNode.lastHeartbeatAt);
  const runtimeLastHeartbeatAt = runtimes
    .map((runtime) => resolveRunnerRuntimeLastSeenAt(runtime))
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString() ?? null;

  const effectiveHeartbeatAt = [nodeHeartbeatAt, runtimeLastHeartbeatAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0]
    ?.toISOString() ?? null;

  const hasRunningRuntime = runtimes.some(
    (runtime) => String(runtime.status ?? "").trim().toLowerCase() === "running"
  );
  if (hasRunningRuntime) {
    return {
      status: "online",
      lastHeartbeatAt: effectiveHeartbeatAt
    };
  }

  return {
    status: deriveRunnerStatus(effectiveHeartbeatAt),
    lastHeartbeatAt: effectiveHeartbeatAt
  };
}

function buildSearchWhere(search: string | undefined, fields: string[]) {
  const term = String(search ?? "").trim();
  if (!term) return undefined;
  return {
    OR: fields.map((field) => ({
      [field]: { contains: term, mode: "insensitive" as const }
    }))
  };
}

function safeSortBy(input: string | undefined, allowed: readonly string[], fallback: string): string {
  const value = String(input ?? "").trim();
  return allowed.includes(value) ? value : fallback;
}

async function buildWorkspaceOwnerMap(db: any, workspaceIds: string[]) {
  if (!workspaceIds.length) return new Map<string, { id: string; email: string; roleName: string | null }>();
  const memberships = await db.workspaceMember.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: {
      workspaceId: true,
      createdAt: true,
      user: { select: { id: true, email: true } },
      role: { select: { name: true } }
    },
    orderBy: [{ workspaceId: "asc" }, { createdAt: "asc" }]
  });
  const map = new Map<string, { id: string; email: string; roleName: string | null }>();
  for (const membership of memberships) {
    const workspaceId = String(membership.workspaceId ?? "");
    if (!workspaceId || map.has(workspaceId)) continue;
    map.set(workspaceId, {
      id: String(membership.user?.id ?? ""),
      email: String(membership.user?.email ?? ""),
      roleName: membership.role?.name ? String(membership.role.name) : null
    });
  }
  return map;
}

export function registerPlatformAdminRoutes(app: express.Express, deps: RegisterPlatformAdminRoutesDeps) {
  app.get("/admin/overview", requireAuth, async (_req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;

    const [userCount, workspaceCount, runningBots, erroredBots, criticalAlerts, subscriptions, runnerNodes, runnerBotRuntimes, recentAlerts, recentAuditEvents, recentErroredBots] = await Promise.all([
      deps.db.user.count(),
      deps.db.workspace.count(),
      deps.db.bot.count({ where: { status: "running" } }),
      deps.db.bot.count({ where: { OR: [{ status: "error" }, { runtime: { is: { lastError: { not: null } } } }] } }),
      deps.db.platformAlert.count({ where: { status: { in: ["open", "acknowledged"] }, severity: "critical" } }),
      deps.db.userSubscription.findMany({
        select: {
          id: true,
          effectivePlan: true,
          status: true,
          proValidUntil: true,
          licenseOperationalState: { select: { verificationStatus: true } }
        }
      }),
      deps.db.runnerNode.findMany({
        select: { id: true, name: true, status: true, lastHeartbeatAt: true, version: true }
      }),
      deps.db.botRuntime.findMany({
        select: {
          workerId: true,
          status: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          updatedAt: true
        }
      }),
      deps.db.platformAlert.findMany({
        where: { severity: "critical" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          severity: true,
          status: true,
          type: true,
          source: true,
          title: true,
          message: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } },
          user: { select: { id: true, email: true } },
          bot: { select: { id: true, name: true } },
          runnerNode: { select: { id: true, name: true } }
        }
      }),
      deps.db.adminAuditEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetLabel: true,
          createdAt: true,
          actor: { select: { id: true, email: true } },
          workspace: { select: { id: true, name: true } }
        }
      }),
      deps.db.bot.findMany({
        where: { OR: [{ status: "error" }, { runtime: { is: { lastError: { not: null } } } }] },
        orderBy: [{ updatedAt: "desc" }],
        take: 6,
        select: {
          id: true,
          name: true,
          symbol: true,
          status: true,
          updatedAt: true,
          lastError: true,
          workspace: { select: { id: true, name: true } },
          user: { select: { id: true, email: true } },
          runtime: { select: { workerId: true, lastHeartbeatAt: true, lastError: true, lastErrorMessage: true } }
        }
      })
    ]);

    const now = Date.now();
    const activeLicenses = subscriptions.filter((item: any) => deriveLicenseStatus({
      effectivePlan: item.effectivePlan,
      status: item.status,
      proValidUntil: isoOrNull(item.proValidUntil),
      verificationStatus: item.licenseOperationalState?.verificationStatus ?? null
    }) === "active").length;
    const expiredLicenses = subscriptions.filter((item: any) => deriveLicenseStatus({
      effectivePlan: item.effectivePlan,
      status: item.status,
      proValidUntil: isoOrNull(item.proValidUntil),
      verificationStatus: item.licenseOperationalState?.verificationStatus ?? null
    }) === "expired").length;
    const runnerRuntimeMap = mapRuntimesToRunnerIds(runnerNodes, runnerBotRuntimes);
    const normalizedRunnerNodes = runnerNodes.map((node: any) => {
      const derived = deriveRunnerStatusFromSignals(node, runnerRuntimeMap.get(String(node.id ?? "").trim()) ?? []);
      return {
        ...node,
        lastHeartbeatAt: derived.lastHeartbeatAt,
        derivedStatus: derived.status
      };
    });
    const onlineRunners = normalizedRunnerNodes.filter((node: any) => String(node.derivedStatus).toLowerCase() === "online").length;
    const offlineRunners = normalizedRunnerNodes.length - onlineRunners;

    const growthRows = await deps.db.user.findMany({
      where: { createdAt: { gte: addDays(startOfDay(new Date()), -29) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" }
    });
    const growthMap = new Map<string, number>();
    for (let index = 0; index < 30; index += 1) {
      growthMap.set(formatDayKey(addDays(startOfDay(new Date()), -29 + index)), 0);
    }
    for (const row of growthRows) {
      const key = formatDayKey(new Date(row.createdAt));
      growthMap.set(key, (growthMap.get(key) ?? 0) + 1);
    }

    return res.json({
      generatedAt: new Date(now).toISOString(),
      stats: {
        totalUsers: userCount,
        activeWorkspaces: workspaceCount,
        activeLicenses,
        expiredLicenses,
        runningBots,
        errorBots: erroredBots,
        openCriticalAlerts: criticalAlerts,
        onlineRunners,
        offlineRunners
      },
      systemHealth: {
        status: criticalAlerts > 0 || erroredBots > 0 ? "attention" : "healthy",
        runners: {
          total: normalizedRunnerNodes.length,
          online: onlineRunners,
          offline: offlineRunners
        },
        alerts: {
          criticalOpen: criticalAlerts
        },
        bots: {
          running: runningBots,
          errored: erroredBots
        }
      },
      latestCriticalAlerts: recentAlerts.map((alert: any) => ({
        id: alert.id,
        severity: alert.severity,
        status: derivePlatformAlertStatus(alert),
        type: alert.type,
        source: alert.source,
        title: alert.title ?? null,
        message: alert.message,
        createdAt: isoOrNull(alert.createdAt),
        user: alert.user ? { id: alert.user.id, email: alert.user.email } : null,
        workspace: alert.workspace ? { id: alert.workspace.id, name: alert.workspace.name } : null,
        bot: alert.bot ? { id: alert.bot.id, name: alert.bot.name } : null,
        runner: alert.runnerNode ? { id: alert.runnerNode.id, name: alert.runnerNode.name } : null
      })),
      recentAuditEvents: recentAuditEvents.map((item: any) => ({
        id: item.id,
        action: item.action,
        targetType: item.targetType,
        targetLabel: item.targetLabel ?? null,
        createdAt: isoOrNull(item.createdAt),
        actor: item.actor ? { id: item.actor.id, email: item.actor.email } : null,
        workspace: item.workspace ? { id: item.workspace.id, name: item.workspace.name } : null
      })),
      userGrowth: Array.from(growthMap.entries()).map(([date, count]) => ({ date, count })),
      licenseHealth: {
        active: activeLicenses,
        expired: expiredLicenses,
        verificationFailed: subscriptions.filter((item: any) => String(item.licenseOperationalState?.verificationStatus ?? "").toLowerCase() === "failed").length
      },
      botsWithErrors: recentErroredBots.map((bot: any) => ({
        id: bot.id,
        name: bot.name,
        symbol: bot.symbol,
        status: bot.status,
        workspace: bot.workspace ? { id: bot.workspace.id, name: bot.workspace.name } : null,
        user: bot.user ? { id: bot.user.id, email: bot.user.email } : null,
        runnerId: bot.runtime?.workerId ?? null,
        lastHeartbeatAt: isoOrNull(bot.runtime?.lastHeartbeatAt),
        lastError: bot.runtime?.lastErrorMessage ?? bot.runtime?.lastError ?? bot.lastError ?? null,
        updatedAt: isoOrNull(bot.updatedAt)
      }))
    });
  });

  app.get("/admin/users", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = usersQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const { page, pageSize, search, status, role, licenseStatus } = parsed.data;
    const userWhere = buildSearchWhere(search, ["email"]);
    const sortField = safeSortBy(parsed.data.sortBy, ["createdAt", "updatedAt", "email"], "createdAt");
    const [rows, adminAccessIds] = await Promise.all([
      deps.db.user.findMany({
        where: userWhere,
        orderBy: { [sortField]: sortField === "email" ? "asc" : parsed.data.sortDir ?? "desc" },
        select: {
          id: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          sessions: {
            select: { createdAt: true, lastActiveAt: true },
            orderBy: [{ lastActiveAt: "desc" }],
            take: 1
          },
          workspaces: {
            select: {
              workspaceId: true,
              status: true,
              role: { select: { name: true } },
              workspace: { select: { id: true, name: true } }
            }
          },
          subscription: {
            select: {
              effectivePlan: true,
              status: true,
              proValidUntil: true,
              licenseOperationalState: {
                select: { verificationStatus: true }
              }
            }
          },
          _count: {
            select: {
              workspaces: true,
              bots: true,
              sessions: true
            }
          }
        }
      }),
      deps.getAdminBackendAccessUserIdSet()
    ]);

    const items = rows
      .map((row: any) => {
        const lastSession = Array.isArray(row.sessions) && row.sessions.length > 0 ? row.sessions[0] : null;
        const lastLoginAt = isoOrNull(lastSession?.createdAt);
        const lastActiveAt = isoOrNull(lastSession?.lastActiveAt);
        const isSuperadmin = deps.isSuperadminEmail(row.email);
        const primaryRole = normalizeRoleSummary({
          isSuperadmin,
          memberships: Array.isArray(row.workspaces) ? row.workspaces : []
        });
        const derivedLicenseStatus = deriveLicenseStatus({
          effectivePlan: row.subscription?.effectivePlan ?? null,
          status: row.subscription?.status ?? null,
          proValidUntil: isoOrNull(row.subscription?.proValidUntil),
          verificationStatus: row.subscription?.licenseOperationalState?.verificationStatus ?? null
        });
        return {
          id: row.id,
          email: row.email,
          name: nameFromEmail(row.email),
          status: toUserStatus(lastActiveAt, lastLoginAt),
          role: primaryRole,
          workspaceCount: row._count?.workspaces ?? 0,
          botCount: row._count?.bots ?? 0,
          licenseStatus: derivedLicenseStatus,
          lastLoginAt,
          lastActiveAt,
          createdAt: isoOrNull(row.createdAt),
          isSuperadmin,
          hasAdminBackendAccess: isSuperadmin || adminAccessIds.has(row.id)
        };
      })
      .filter((item: any) => (!status || item.status === status))
      .filter((item: any) => (!role || item.role === role))
      .filter((item: any) => (!licenseStatus || item.licenseStatus === licenseStatus));
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      items: pagedItems,
      pagination: pagination(page, pageSize, items.length),
      filterOptions: {
        status: ["active", "idle", "never_logged_in"],
        role: ["Superadmin", "Admin", "User", "Operator 1", "Operator 2", "Viewer", "Mixed"],
        licenseStatus: ["active", "expiring_soon", "expired", "inactive", "verification_failed"]
      }
    });
  });

  app.get("/admin/users/:id", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const [user, adminAccessIds] = await Promise.all([
      deps.db.user.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          sessions: {
            select: { createdAt: true, lastActiveAt: true, expiresAt: true },
            orderBy: [{ lastActiveAt: "desc" }],
            take: 10
          },
          workspaces: {
            select: {
              id: true,
              workspaceId: true,
              status: true,
              createdAt: true,
              role: { select: { id: true, name: true } },
              workspace: { select: { id: true, name: true, createdAt: true } }
            },
            orderBy: [{ createdAt: "asc" }]
          },
          bots: {
            take: 10,
            orderBy: [{ updatedAt: "desc" }],
            select: {
              id: true,
              name: true,
              symbol: true,
              exchange: true,
              status: true,
              workspace: { select: { id: true, name: true } },
              runtime: { select: { workerId: true, lastHeartbeatAt: true, lastErrorMessage: true, lastError: true } },
              createdAt: true,
              updatedAt: true
            }
          },
          subscription: {
            select: {
              id: true,
              effectivePlan: true,
              status: true,
              proValidUntil: true,
              maxRunningBots: true,
              licenseOperationalState: {
                select: {
                  instanceId: true,
                  verificationStatus: true,
                  lastVerifiedAt: true,
                  verificationError: true
                }
              },
              orders: {
                take: 8,
                orderBy: [{ createdAt: "desc" }],
                select: {
                  id: true,
                  merchantOrderId: true,
                  status: true,
                  amountCents: true,
                  currency: true,
                  createdAt: true,
                  paidAt: true,
                  pkg: { select: { name: true, code: true } }
                }
              }
            }
          }
        }
      }),
      deps.getAdminBackendAccessUserIdSet()
    ]);
    if (!user) return res.status(404).json({ error: "not_found" });

    const [recentAlerts, recentAdminAuditEvents, workspaceAuditEvents] = await Promise.all([
      deps.db.platformAlert.findMany({
        where: { userId: user.id },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          severity: true,
          status: true,
          type: true,
          source: true,
          title: true,
          message: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } },
          bot: { select: { id: true, name: true } }
        }
      }),
      deps.db.adminAuditEvent.findMany({
        where: {
          OR: [
            { targetType: "user", targetId: user.id },
            { actorUserId: user.id }
          ]
        },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          targetLabel: true,
          createdAt: true,
          actor: { select: { id: true, email: true } },
          workspace: { select: { id: true, name: true } }
        }
      }),
      deps.db.auditEvent.findMany({
        where: {
          OR: [
            { actorUserId: user.id },
            { workspaceId: { in: (user.workspaces ?? []).map((membership: any) => membership.workspaceId).filter(Boolean) } }
          ]
        },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          workspace: { select: { id: true, name: true } }
        }
      })
    ]);

    const lastSession = Array.isArray(user.sessions) && user.sessions.length > 0 ? user.sessions[0] : null;
    const lastLoginAt = isoOrNull(lastSession?.createdAt);
    const lastActiveAt = isoOrNull(lastSession?.lastActiveAt);

    return res.json({
      id: user.id,
      email: user.email,
      name: nameFromEmail(user.email),
      isSuperadmin: deps.isSuperadminEmail(user.email),
      hasAdminBackendAccess: deps.isSuperadminEmail(user.email) || adminAccessIds.has(user.id),
      status: toUserStatus(lastActiveAt, lastLoginAt),
      createdAt: isoOrNull(user.createdAt),
      updatedAt: isoOrNull(user.updatedAt),
      lastLoginAt,
      lastActiveAt,
      memberships: (user.workspaces ?? []).map((membership: any) => ({
        id: membership.id,
        status: membership.status,
        role: membership.role ? { id: membership.role.id, name: membership.role.name } : null,
        workspace: membership.workspace ? { id: membership.workspace.id, name: membership.workspace.name } : null,
        createdAt: isoOrNull(membership.createdAt)
      })),
      botSummary: {
        total: user.bots?.length ?? 0,
        items: (user.bots ?? []).map((bot: any) => ({
          id: bot.id,
          name: bot.name,
          symbol: bot.symbol,
          exchange: bot.exchange,
          status: bot.status,
          workspace: bot.workspace ? { id: bot.workspace.id, name: bot.workspace.name } : null,
          runnerId: bot.runtime?.workerId ?? null,
          lastHeartbeatAt: isoOrNull(bot.runtime?.lastHeartbeatAt),
          lastError: bot.runtime?.lastErrorMessage ?? bot.runtime?.lastError ?? null,
          createdAt: isoOrNull(bot.createdAt),
          updatedAt: isoOrNull(bot.updatedAt)
        }))
      },
      license: user.subscription
        ? {
            id: user.subscription.id,
            effectivePlan: user.subscription.effectivePlan,
            status: user.subscription.status,
            derivedStatus: deriveLicenseStatus({
              effectivePlan: user.subscription.effectivePlan,
              status: user.subscription.status,
              proValidUntil: isoOrNull(user.subscription.proValidUntil),
              verificationStatus: user.subscription.licenseOperationalState?.verificationStatus ?? null
            }),
            proValidUntil: isoOrNull(user.subscription.proValidUntil),
            maxRunningBots: user.subscription.maxRunningBots,
            operational: user.subscription.licenseOperationalState
              ? {
                  instanceId: user.subscription.licenseOperationalState.instanceId ?? null,
                  verificationStatus: user.subscription.licenseOperationalState.verificationStatus,
                  lastVerifiedAt: isoOrNull(user.subscription.licenseOperationalState.lastVerifiedAt),
                  verificationError: user.subscription.licenseOperationalState.verificationError ?? null
                }
              : null,
            history: (user.subscription.orders ?? []).map((order: any) => ({
              id: order.id,
              merchantOrderId: order.merchantOrderId,
              status: order.status,
              amountCents: order.amountCents,
              currency: order.currency,
              package: order.pkg ? { code: order.pkg.code, name: order.pkg.name } : null,
              createdAt: isoOrNull(order.createdAt),
              paidAt: isoOrNull(order.paidAt)
            }))
          }
        : null,
      recentAlerts: recentAlerts.map((alert: any) => ({
        id: alert.id,
        severity: alert.severity,
        status: derivePlatformAlertStatus(alert),
        type: alert.type,
        source: alert.source,
        title: alert.title ?? null,
        message: alert.message,
        createdAt: isoOrNull(alert.createdAt),
        workspace: alert.workspace ? { id: alert.workspace.id, name: alert.workspace.name } : null,
        bot: alert.bot ? { id: alert.bot.id, name: alert.bot.name } : null
      })),
      recentAdminAuditEvents: recentAdminAuditEvents.map((event: any) => ({
        id: event.id,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? null,
        targetLabel: event.targetLabel ?? null,
        createdAt: isoOrNull(event.createdAt),
        actor: event.actor ? { id: event.actor.id, email: event.actor.email } : null,
        workspace: event.workspace ? { id: event.workspace.id, name: event.workspace.name } : null
      })),
      workspaceAuditEvents: workspaceAuditEvents.map((event: any) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        createdAt: isoOrNull(event.createdAt),
        workspace: event.workspace ? { id: event.workspace.id, name: event.workspace.name } : null
      }))
    });
  });

  app.get("/admin/workspaces", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = workspacesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const { page, pageSize, search, status, licenseStatus } = parsed.data;

    const where = buildSearchWhere(search, ["name"]);
    const rows = await deps.db.workspace.findMany({
      where,
      orderBy: { createdAt: parsed.data.sortDir ?? "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        licenseEntitlement: {
          select: {
            plan: true
          }
        },
        members: {
          select: {
            id: true,
            createdAt: true
          }
        },
        bots: {
          select: {
            id: true,
            status: true,
            updatedAt: true
          }
        }
      }
    });
    const ownerMap = await buildWorkspaceOwnerMap(deps.db, rows.map((row: any) => row.id));

    const items = rows
      .map((row: any) => {
        const lastBotUpdate = (row.bots ?? []).reduce((latest: Date | null, bot: any) => {
          const candidate = bot?.updatedAt instanceof Date ? bot.updatedAt : bot?.updatedAt ? new Date(bot.updatedAt) : null;
          if (!candidate || Number.isNaN(candidate.getTime())) return latest;
          if (!latest || candidate.getTime() > latest.getTime()) return candidate;
          return latest;
        }, null);
        const derivedStatus = (row.bots ?? []).some((bot: any) => String(bot.status).toLowerCase() === "running")
          ? "active"
          : "idle";
        const derivedLicenseStatus = row.licenseEntitlement?.plan ? "active" : "inactive";
        return {
          id: row.id,
          name: row.name,
          owner: ownerMap.get(row.id) ?? null,
          membersCount: row.members?.length ?? 0,
          botsCount: row.bots?.length ?? 0,
          licenseStatus: derivedLicenseStatus,
          plan: row.licenseEntitlement?.plan ?? "free",
          lastActiveAt: isoOrNull(lastBotUpdate),
          createdAt: isoOrNull(row.createdAt),
          status: derivedStatus
        };
      })
      .filter((item: any) => (!status || item.status === status))
      .filter((item: any) => (!licenseStatus || item.licenseStatus === licenseStatus));
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      items: pagedItems,
      pagination: pagination(page, pageSize, items.length)
    });
  });

  app.get("/admin/workspaces/:id", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const workspace = await deps.db.workspace.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        members: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            createdAt: true,
            status: true,
            role: { select: { id: true, name: true } },
            user: { select: { id: true, email: true } }
          }
        },
        bots: {
          orderBy: [{ updatedAt: "desc" }],
          take: 20,
          select: {
            id: true,
            name: true,
            symbol: true,
            exchange: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, email: true } }
          }
        },
        licenseEntitlement: {
          select: {
            id: true,
            plan: true,
            allowedStrategyKinds: true,
            aiAllowedModels: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    if (!workspace) return res.status(404).json({ error: "not_found" });

    const [recentAlerts, recentAdminAuditEvents, recentWorkspaceAuditEvents] = await Promise.all([
      deps.db.platformAlert.findMany({
        where: { workspaceId: workspace.id },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          severity: true,
          status: true,
          type: true,
          source: true,
          title: true,
          message: true,
          createdAt: true,
          user: { select: { id: true, email: true } },
          bot: { select: { id: true, name: true } }
        }
      }),
      deps.db.adminAuditEvent.findMany({
        where: { workspaceId: workspace.id },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          targetLabel: true,
          createdAt: true,
          actor: { select: { id: true, email: true } }
        }
      }),
      deps.db.auditEvent.findMany({
        where: { workspaceId: workspace.id },
        take: 10,
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, email: true } }
        }
      })
    ]);

    const owner = workspace.members?.[0]?.user
      ? {
          id: workspace.members[0].user.id,
          email: workspace.members[0].user.email,
          roleName: workspace.members[0].role?.name ?? null
        }
      : null;

    return res.json({
      id: workspace.id,
      name: workspace.name,
      createdAt: isoOrNull(workspace.createdAt),
      owner,
      members: (workspace.members ?? []).map((member: any) => ({
        id: member.id,
        status: member.status,
        createdAt: isoOrNull(member.createdAt),
        role: member.role ? { id: member.role.id, name: member.role.name } : null,
        user: member.user ? { id: member.user.id, email: member.user.email } : null
      })),
      bots: (workspace.bots ?? []).map((bot: any) => ({
        id: bot.id,
        name: bot.name,
        symbol: bot.symbol,
        exchange: bot.exchange,
        status: bot.status,
        createdAt: isoOrNull(bot.createdAt),
        updatedAt: isoOrNull(bot.updatedAt),
        user: bot.user ? { id: bot.user.id, email: bot.user.email } : null
      })),
      license: workspace.licenseEntitlement
        ? {
            id: workspace.licenseEntitlement.id,
            plan: workspace.licenseEntitlement.plan,
            allowedStrategyKinds: workspace.licenseEntitlement.allowedStrategyKinds,
            aiAllowedModels: workspace.licenseEntitlement.aiAllowedModels,
            createdAt: isoOrNull(workspace.licenseEntitlement.createdAt),
            updatedAt: isoOrNull(workspace.licenseEntitlement.updatedAt)
          }
        : null,
      usage: {
        membersCount: workspace.members?.length ?? 0,
        botsCount: workspace.bots?.length ?? 0,
        runningBots: (workspace.bots ?? []).filter((bot: any) => String(bot.status).toLowerCase() === "running").length
      },
      recentAlerts: recentAlerts.map((alert: any) => ({
        id: alert.id,
        severity: alert.severity,
        status: derivePlatformAlertStatus(alert),
        type: alert.type,
        source: alert.source,
        title: alert.title ?? null,
        message: alert.message,
        createdAt: isoOrNull(alert.createdAt),
        user: alert.user ? { id: alert.user.id, email: alert.user.email } : null,
        bot: alert.bot ? { id: alert.bot.id, name: alert.bot.name } : null
      })),
      recentAdminAuditEvents: recentAdminAuditEvents.map((event: any) => ({
        id: event.id,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId ?? null,
        targetLabel: event.targetLabel ?? null,
        createdAt: isoOrNull(event.createdAt),
        actor: event.actor ? { id: event.actor.id, email: event.actor.email } : null
      })),
      recentWorkspaceAuditEvents: recentWorkspaceAuditEvents.map((event: any) => ({
        id: event.id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        createdAt: isoOrNull(event.createdAt),
        actor: event.actor ? { id: event.actor.id, email: event.actor.email } : null
      }))
    });
  });

  app.get("/admin/licenses", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = licensesQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const { page, pageSize, search, status } = parsed.data;
    const where = search
      ? {
          OR: [
            { user: { email: { contains: search, mode: "insensitive" as const } } },
            { orders: { some: { merchantOrderId: { contains: search, mode: "insensitive" as const } } } }
          ]
        }
      : undefined;
    const rows = await deps.db.userSubscription.findMany({
      where,
      orderBy: { updatedAt: parsed.data.sortDir ?? "desc" },
      select: {
        id: true,
        effectivePlan: true,
        status: true,
        proValidUntil: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            workspaces: {
              take: 1,
              orderBy: [{ createdAt: "asc" }],
              select: {
                workspace: { select: { id: true, name: true } }
              }
            }
          }
        },
        licenseOperationalState: {
          select: {
            instanceId: true,
            verificationStatus: true,
            lastVerifiedAt: true,
            verificationError: true,
            workspace: { select: { id: true, name: true } }
          }
        },
        orders: {
          take: 1,
          orderBy: [{ createdAt: "desc" }],
          select: {
            merchantOrderId: true
          }
        }
      }
    });

    const items = rows
      .map((row: any) => {
        const workspace = row.licenseOperationalState?.workspace
          ?? row.user?.workspaces?.[0]?.workspace
          ?? null;
        const derivedStatus = deriveLicenseStatus({
          effectivePlan: row.effectivePlan,
          status: row.status,
          proValidUntil: isoOrNull(row.proValidUntil),
          verificationStatus: row.licenseOperationalState?.verificationStatus ?? null
        });
        return {
          id: row.id,
          licenseIdentifier: row.orders?.[0]?.merchantOrderId ?? row.id,
          status: derivedStatus,
          assignedUser: row.user ? { id: row.user.id, email: row.user.email } : null,
          assignedWorkspace: workspace ? { id: workspace.id, name: workspace.name } : null,
          plan: row.effectivePlan,
          instanceId: row.licenseOperationalState?.instanceId ?? null,
          lastVerification: isoOrNull(row.licenseOperationalState?.lastVerifiedAt),
          expiresAt: isoOrNull(row.proValidUntil),
          createdAt: isoOrNull(row.createdAt),
          verificationState: row.licenseOperationalState?.verificationStatus ?? "unknown",
          verificationError: row.licenseOperationalState?.verificationError ?? null
        };
      })
      .filter((item: any) => (!status || item.status === status));
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      items: pagedItems,
      pagination: pagination(page, pageSize, items.length),
      filterOptions: {
        status: ["active", "expiring_soon", "expired", "inactive", "verification_failed"]
      }
    });
  });

  app.get("/admin/alerts", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = alertsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const { page, pageSize, search, severity, status, type, source } = parsed.data;

    const where: Record<string, unknown> = {};
    if (severity) where.severity = severity;
    if (status) where.status = status;
    if (type) where.type = type;
    if (source) where.source = source;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { message: { contains: search, mode: "insensitive" } }
      ];
    }

    const [retention, total, rows] = await Promise.all([
      getPlatformAlertRetentionSettings(deps.db),
      deps.db.platformAlert.count({ where }),
      deps.db.platformAlert.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: parsed.data.sortDir ?? "desc" },
        select: {
          id: true,
          severity: true,
          status: true,
          type: true,
          source: true,
          title: true,
          message: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true } },
          workspace: { select: { id: true, name: true } },
          bot: { select: { id: true, name: true } },
          runnerNode: { select: { id: true, name: true } }
        }
      })
    ]);

    return res.json({
      items: rows.map((alert: any) => ({
        id: alert.id,
        severity: alert.severity,
        status: derivePlatformAlertStatus(alert),
        type: alert.type,
        source: alert.source,
        title: alert.title ?? null,
        message: alert.message,
        createdAt: isoOrNull(alert.createdAt),
        updatedAt: isoOrNull(alert.updatedAt),
        user: alert.user ? { id: alert.user.id, email: alert.user.email } : null,
        workspace: alert.workspace ? { id: alert.workspace.id, name: alert.workspace.name } : null,
        bot: alert.bot ? { id: alert.bot.id, name: alert.bot.name } : null,
        runner: alert.runnerNode ? { id: alert.runnerNode.id, name: alert.runnerNode.name } : null
      })),
      pagination: pagination(page, pageSize, total),
      retention: {
        autoDeleteOlderThan30Days: retention.autoDeleteOlderThan30Days,
        retentionDays: PLATFORM_ALERT_RETENTION_DAYS,
        updatedAt: retention.updatedAt
      },
      filterOptions: {
        severity: ["critical", "high", "medium", "low"],
        status: ["open", "acknowledged", "resolved"],
        source: ["bot", "runner", "system", "license"],
        type: ["bot_alert", "runner_health", "license_verification", "system", "system_health"]
      }
    });
  });

  app.put("/admin/alerts/retention", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = alertRetentionMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const actor = deps.readUserFromLocals(res);
    const settings = await setPlatformAlertRetentionSettings(
      deps.db,
      parsed.data.autoDeleteOlderThan30Days
    );

    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: "platform_alert.retention.updated",
      targetType: "platform_alert_retention",
      targetId: null,
      targetLabel: "Platform alert retention",
      metadata: {
        autoDeleteOlderThan30Days: settings.autoDeleteOlderThan30Days,
        retentionDays: PLATFORM_ALERT_RETENTION_DAYS
      },
      ip: res.req.ip ?? null
    });

    return res.json({
      ok: true,
      retention: {
        autoDeleteOlderThan30Days: settings.autoDeleteOlderThan30Days,
        retentionDays: PLATFORM_ALERT_RETENTION_DAYS,
        updatedAt: settings.updatedAt
      }
    });
  });

  app.post("/admin/alerts/delete", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = alertDeleteMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const actor = deps.readUserFromLocals(res);
    const scope = parsed.data.scope;
    const where =
      scope === "older_than_30_days"
        ? {
            createdAt: {
              lt: resolvePlatformAlertRetentionCutoff(new Date(), PLATFORM_ALERT_RETENTION_DAYS)
            }
          }
        : {};
    const deleted = await deps.db.platformAlert.deleteMany({ where });
    const deletedCount = Number(deleted?.count ?? 0);

    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: scope === "all" ? "platform_alert.deleted_all" : "platform_alert.deleted_older_than_30_days",
      targetType: "platform_alert",
      targetId: null,
      targetLabel: scope === "all" ? "All platform alerts" : `Platform alerts older than ${PLATFORM_ALERT_RETENTION_DAYS} days`,
      metadata: {
        scope,
        deletedCount,
        retentionDays: PLATFORM_ALERT_RETENTION_DAYS
      },
      ip: res.req.ip ?? null
    });

    return res.json({
      ok: true,
      deletedCount,
      scope
    });
  });

  app.post("/admin/alerts/:id/status", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = alertStatusMutationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() });

    const actor = deps.readUserFromLocals(res);
    const existing = await deps.db.platformAlert.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        status: true
      }
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    const nextStatus = parsed.data.status;
    const updated = await deps.db.platformAlert.update({
      where: { id: req.params.id },
      data: nextStatus === "resolved"
        ? {
            status: "resolved",
            resolvedAt: new Date(),
            resolvedByUserId: actor.id
          }
        : {
            status: "acknowledged",
            acknowledgedAt: new Date(),
            acknowledgedByUserId: actor.id
          },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        acknowledgedAt: true,
        resolvedAt: true
      }
    });

    await deps.recordAdminAuditEvent({
      actorUserId: actor.id,
      action: nextStatus === "resolved" ? "platform_alert.resolved" : "platform_alert.acknowledged",
      targetType: "platform_alert",
      targetId: existing.id,
      targetLabel: existing.title ?? existing.id,
      workspaceId: existing.workspaceId ?? null,
      metadata: {
        previousStatus: existing.status,
        nextStatus
      },
      ip: res.req.ip ?? null
    });

    return res.json({
      ok: true,
      item: {
        id: updated.id,
        status: updated.status,
        updatedAt: isoOrNull(updated.updatedAt),
        acknowledgedAt: isoOrNull(updated.acknowledgedAt),
        resolvedAt: isoOrNull(updated.resolvedAt)
      }
    });
  });

  app.get("/admin/bots", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = botsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const { page, pageSize, search, status, exchange, symbol, workspaceId, runnerId, strategyType } = parsed.data;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (exchange) where.exchange = exchange;
    if (symbol) where.symbol = { contains: symbol, mode: "insensitive" };
    if (workspaceId) where.workspaceId = workspaceId;
    if (runnerId) where.runtime = { is: { workerId: runnerId } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { symbol: { contains: search, mode: "insensitive" } }
      ];
    }

    const rows = await deps.db.bot.findMany({
      where,
      orderBy: { updatedAt: parsed.data.sortDir ?? "desc" },
      select: {
        id: true,
        name: true,
        symbol: true,
        exchange: true,
        status: true,
        lastError: true,
        createdAt: true,
        workspace: { select: { id: true, name: true } },
        user: { select: { id: true, email: true } },
        runtime: { select: { workerId: true, lastHeartbeatAt: true, lastError: true, lastErrorMessage: true } },
        futuresConfig: { select: { strategyKey: true } },
        gridInstance: { select: { id: true } }
      }
    });

    const items = rows
      .map((bot: any) => {
        const derivedStrategyType = bot.gridInstance?.id ? "grid" : bot.futuresConfig?.strategyKey ?? "manual";
        return {
          id: bot.id,
          name: bot.name,
          workspace: bot.workspace ? { id: bot.workspace.id, name: bot.workspace.name } : null,
          owner: bot.user ? { id: bot.user.id, email: bot.user.email } : null,
          exchange: bot.exchange,
          symbol: bot.symbol,
          strategyType: derivedStrategyType,
          status: bot.status,
          runnerId: bot.runtime?.workerId ?? null,
          lastHeartbeatAt: isoOrNull(bot.runtime?.lastHeartbeatAt),
          lastError: bot.runtime?.lastErrorMessage ?? bot.runtime?.lastError ?? bot.lastError ?? null,
          createdAt: isoOrNull(bot.createdAt)
        };
      })
      .filter((item: any) => (!strategyType || item.strategyType === strategyType));
    const pagedItems = items.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      items: pagedItems,
      pagination: pagination(page, pageSize, items.length)
    });
  });

  app.get("/admin/runners", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = runnersQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const { page, pageSize, status } = parsed.data;
    const rows = await deps.db.runnerNode.findMany({
      orderBy: { updatedAt: parsed.data.sortDir ?? "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        lastHeartbeatAt: true,
        version: true,
        region: true,
        host: true,
        metadata: true
      }
    });

    const botRuntimes = rows.length
      ? await deps.db.botRuntime.findMany({
          select: {
            workerId: true,
            status: true,
            lastHeartbeatAt: true,
            lastTickAt: true,
            updatedAt: true
          }
        })
      : [];
    const runnerRuntimeMap = mapRuntimesToRunnerIds(rows, botRuntimes);

    const derivedItems = rows
      .map((row: any) => {
        const runnerRuntimes = runnerRuntimeMap.get(String(row.id ?? "").trim()) ?? [];
        const currentCounts = runnerRuntimes.reduce(
          (acc, runtime) => {
            acc.bots += 1;
            if (String(runtime.status ?? "").trim().toLowerCase() === "error") acc.errors += 1;
            return acc;
          },
          { bots: 0, errors: 0 }
        );
        const derived = deriveRunnerStatusFromSignals(row, runnerRuntimes);
        return {
          id: row.id,
          name: row.name,
          status: derived.status,
          lastHeartbeatAt: derived.lastHeartbeatAt,
          assignedBotsCount: currentCounts.bots,
          errorCount: currentCounts.errors,
          version: row.version ?? null,
          region: row.region ?? null,
          host: row.host ?? null
        };
      })
      .filter((item) => !status || item.status === status);

    const total = derivedItems.length;
    const pagedItems = derivedItems.slice((page - 1) * pageSize, page * pageSize);

    return res.json({
      items: pagedItems,
      pagination: pagination(page, pageSize, total)
    });
  });

  app.get("/admin/audit", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = auditQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });
    const { page, pageSize, actorId, action, targetType, workspaceId, dateFrom, dateTo, search } = parsed.data;
    const where: Record<string, unknown> = {};
    if (actorId) where.actorUserId = actorId;
    if (action) where.action = { contains: action, mode: "insensitive" };
    if (targetType) where.targetType = targetType;
    if (workspaceId) where.workspaceId = workspaceId;
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {})
      };
    }
    if (search) {
      where.OR = [
        { targetLabel: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } }
      ];
    }

    const total = await deps.db.adminAuditEvent.count({ where });
    const rows = await deps.db.adminAuditEvent.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: parsed.data.sortDir ?? "desc" },
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        targetLabel: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, email: true } },
        workspace: { select: { id: true, name: true } }
      }
    });

    return res.json({
      items: rows.map((row: any) => ({
        id: row.id,
        timestamp: isoOrNull(row.createdAt),
        actor: row.actor ? { id: row.actor.id, email: row.actor.email } : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId ?? null,
        targetLabel: row.targetLabel ?? null,
        workspace: row.workspace ? { id: row.workspace.id, name: row.workspace.name } : null,
        metadataPreview: row.metadata ?? null
      })),
      pagination: pagination(page, pageSize, total)
    });
  });

  app.get("/admin/statistics", requireAuth, async (req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const parsed = statisticsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

    const now = startOfDay(new Date());
    const windowDays = parsed.data.period === "7d" ? 7 : parsed.data.period === "30d" ? 30 : parsed.data.period === "90d" ? 90 : 180;
    const from = addDays(now, -(windowDays - 1));
    const dayKeys = Array.from({ length: windowDays }, (_, index) => formatDayKey(addDays(from, index)));

    const [users, workspaces, subscriptions, bots, alerts, runners, runnerBotRuntimes] = await Promise.all([
      deps.db.user.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      deps.db.workspace.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      deps.db.userSubscription.findMany({
        select: {
          createdAt: true,
          effectivePlan: true,
          status: true,
          proValidUntil: true,
          licenseOperationalState: { select: { verificationStatus: true } }
        }
      }),
      deps.db.bot.findMany({ select: { createdAt: true, status: true, exchange: true } }),
      deps.db.platformAlert.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true, severity: true, type: true } }),
      deps.db.runnerNode.findMany({ select: { id: true, name: true, lastHeartbeatAt: true, status: true } }),
      deps.db.botRuntime.findMany({
        select: {
          workerId: true,
          status: true,
          lastHeartbeatAt: true,
          lastTickAt: true,
          updatedAt: true
        }
      })
    ]);
    const runnerRuntimeMap = mapRuntimesToRunnerIds(runners, runnerBotRuntimes);
    const runnerStatuses = runners.map((row: any) =>
      deriveRunnerStatusFromSignals(row, runnerRuntimeMap.get(String(row.id ?? "").trim()) ?? []).status
    );

    const userSeries = new Map(dayKeys.map((key) => [key, 0]));
    const workspaceSeries = new Map(dayKeys.map((key) => [key, 0]));
    for (const row of users) {
      const key = formatDayKey(new Date(row.createdAt));
      if (userSeries.has(key)) userSeries.set(key, (userSeries.get(key) ?? 0) + 1);
    }
    for (const row of workspaces) {
      const key = formatDayKey(new Date(row.createdAt));
      if (workspaceSeries.has(key)) workspaceSeries.set(key, (workspaceSeries.get(key) ?? 0) + 1);
    }

    const licenseByStatus = subscriptions.reduce((acc: Record<string, number>, row: any) => {
      const key = deriveLicenseStatus({
        effectivePlan: row.effectivePlan,
        status: row.status,
        proValidUntil: isoOrNull(row.proValidUntil),
        verificationStatus: row.licenseOperationalState?.verificationStatus ?? null
      });
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    const botByStatus = bots.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row.status ?? "unknown").toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const exchangeDistribution = bots.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row.exchange ?? "unknown").toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const alertsBySeverity = alerts.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row.severity ?? "medium").toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const alertsByType = alerts.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row.type ?? "unknown").toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return res.json({
      period: parsed.data.period,
      kpis: {
        registrations: users.length,
        workspacesCreated: workspaces.length,
        totalBots: bots.length,
        totalAlerts: alerts.length
      },
      registrationsOverTime: Array.from(userSeries.entries()).map(([date, count]) => ({ date, count })),
      workspacesOverTime: Array.from(workspaceSeries.entries()).map(([date, count]) => ({ date, count })),
      botsByStatus: botByStatus,
      alertsBySeverity,
      alertsByType,
      licensesByStatus: licenseByStatus,
      exchangeUsageDistribution: exchangeDistribution,
      runnerUptimeSummary: {
        total: runners.length,
        online: runnerStatuses.filter((value) => value === "online").length,
        offline: runnerStatuses.filter((value) => value === "offline").length
      }
    });
  });

  app.get("/admin/system", requireAuth, async (_req, res) => {
    if (!(await deps.requirePlatformSuperadmin(res))) return;
    const [accessSection, serverInfo, billingFlags] = await Promise.all([
      deps.getAccessSectionSettings().catch(() => null),
      deps.getServerInfoSettings().catch(() => null),
      deps.getBillingFeatureFlagsSettings().catch(() => null)
    ]);

    return res.json({
      maintenance: accessSection?.maintenance
        ? {
            enabled: Boolean(accessSection.maintenance.enabled),
            message: accessSection.maintenance.message ?? null
          }
        : null,
      serverInfo: serverInfo
        ? {
            serverIpAddress: serverInfo.serverIpAddress ?? null,
            updatedAt: serverInfo.updatedAt ?? null,
            source: serverInfo.source ?? "none"
          }
        : null,
      billing: billingFlags
        ? {
            billingEnabled: Boolean(billingFlags.flags?.billingEnabled),
            billingWebhookEnabled: Boolean(billingFlags.flags?.billingWebhookEnabled),
            updatedAt: billingFlags.updatedAt ?? null,
            source: billingFlags.source ?? "none"
          }
        : null,
      legacyLinks: [
        "/admin/legacy/access-section",
        "/admin/legacy/api-keys",
        "/admin/legacy/billing",
        "/admin/legacy/exchanges",
        "/admin/legacy/server-info",
        "/admin/legacy/smtp",
        "/admin/legacy/telegram",
        "/admin/legacy/vault-execution",
        "/admin/legacy/vault-operations",
        "/admin/legacy/vault-safety",
        "/admin/legacy/indicator-settings",
        "/admin/legacy/grid-templates",
        "/admin/legacy/strategies",
        "/admin/legacy/prediction-refresh",
        "/admin/legacy/prediction-defaults",
        "/admin/legacy/ai-trace"
      ]
    });
  });
}
