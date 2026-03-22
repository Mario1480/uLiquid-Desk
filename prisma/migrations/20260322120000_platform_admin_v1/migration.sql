CREATE TABLE "admin_audit_events" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "target_label" TEXT,
  "workspace_id" TEXT,
  "metadata" JSONB,
  "ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "license_operational_states" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "instance_id" TEXT,
  "verification_status" TEXT NOT NULL DEFAULT 'unknown',
  "last_verified_at" TIMESTAMP(3),
  "verification_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "license_operational_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runner_nodes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "last_heartbeat_at" TIMESTAMP(3),
  "version" TEXT,
  "region" TEXT,
  "host" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runner_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_alerts" (
  "id" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT,
  "message" TEXT NOT NULL,
  "user_id" TEXT,
  "workspace_id" TEXT,
  "bot_id" TEXT,
  "runner_node_id" TEXT,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by_user_id" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolved_by_user_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "license_operational_states_subscription_id_key" ON "license_operational_states"("subscription_id");
CREATE INDEX "admin_audit_events_actor_created_idx" ON "admin_audit_events"("actor_user_id", "created_at");
CREATE INDEX "admin_audit_events_workspace_created_idx" ON "admin_audit_events"("workspace_id", "created_at");
CREATE INDEX "admin_audit_events_target_created_idx" ON "admin_audit_events"("target_type", "target_id", "created_at");
CREATE INDEX "admin_audit_events_created_idx" ON "admin_audit_events"("created_at");
CREATE INDEX "license_operational_states_verification_idx" ON "license_operational_states"("verification_status");
CREATE INDEX "license_operational_states_workspace_idx" ON "license_operational_states"("workspace_id");
CREATE INDEX "runner_nodes_status_heartbeat_idx" ON "runner_nodes"("status", "last_heartbeat_at");
CREATE INDEX "platform_alerts_status_severity_created_idx" ON "platform_alerts"("status", "severity", "created_at");
CREATE INDEX "platform_alerts_workspace_created_idx" ON "platform_alerts"("workspace_id", "created_at");
CREATE INDEX "platform_alerts_user_created_idx" ON "platform_alerts"("user_id", "created_at");
CREATE INDEX "platform_alerts_bot_created_idx" ON "platform_alerts"("bot_id", "created_at");
CREATE INDEX "platform_alerts_runner_created_idx" ON "platform_alerts"("runner_node_id", "created_at");

ALTER TABLE "admin_audit_events"
  ADD CONSTRAINT "admin_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_audit_events"
  ADD CONSTRAINT "admin_audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "license_operational_states"
  ADD CONSTRAINT "license_operational_states_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "user_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "license_operational_states"
  ADD CONSTRAINT "license_operational_states_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_runner_node_id_fkey"
  FOREIGN KEY ("runner_node_id") REFERENCES "runner_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_acknowledged_by_user_id_fkey"
  FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_alerts"
  ADD CONSTRAINT "platform_alerts_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "runner_nodes" ("id", "name", "status", "last_heartbeat_at", "version", "metadata")
SELECT
  "id",
  'Main runner',
  CASE
    WHEN "lastTickAt" >= NOW() - INTERVAL '5 minutes' THEN 'online'
    ELSE 'offline'
  END,
  "lastTickAt",
  "version",
  jsonb_build_object(
    'source', 'runner_status_backfill',
    'botsRunning', "botsRunning",
    'botsErrored', "botsErrored"
  )
FROM "RunnerStatus"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "license_operational_states" (
  "id",
  "subscription_id",
  "workspace_id",
  "verification_status",
  "created_at",
  "updated_at"
)
SELECT
  'los_' || md5(us."id" || COALESCE(wm."workspaceId", '')),
  us."id",
  wm."workspaceId",
  'unknown',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "user_subscriptions" us
LEFT JOIN LATERAL (
  SELECT wm_inner."workspaceId"
  FROM "WorkspaceMember" wm_inner
  WHERE wm_inner."userId" = us."user_id"
  ORDER BY wm_inner."createdAt" ASC
  LIMIT 1
) wm ON TRUE
ON CONFLICT ("subscription_id") DO NOTHING;

INSERT INTO "platform_alerts" (
  "id",
  "severity",
  "status",
  "type",
  "source",
  "title",
  "message",
  "user_id",
  "workspace_id",
  "bot_id",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  ba."id",
  CASE lower(COALESCE(ba."level", 'warning'))
    WHEN 'critical' THEN 'critical'
    WHEN 'error' THEN 'critical'
    WHEN 'warn' THEN 'high'
    WHEN 'warning' THEN 'high'
    WHEN 'info' THEN 'medium'
    ELSE 'medium'
  END,
  'open',
  'bot_alert',
  'bot',
  ba."title",
  COALESCE(NULLIF(ba."message", ''), ba."title"),
  b."userId",
  b."workspaceId",
  ba."botId",
  jsonb_build_object(
    'source', 'bot_alert_backfill',
    'originalLevel', ba."level"
  ),
  ba."createdAt",
  ba."createdAt"
FROM "BotAlert" ba
LEFT JOIN "Bot" b ON b."id" = ba."botId"
ON CONFLICT ("id") DO NOTHING;
