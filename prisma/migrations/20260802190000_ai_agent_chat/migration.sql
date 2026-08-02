CREATE TABLE "ai_agent_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "base_profile_key" TEXT NOT NULL,
  "enabled_skill_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowed_exchange_account_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "preferred_venue" TEXT NOT NULL DEFAULT 'auto',
  "preferred_market_type" TEXT,
  "action_level" TEXT NOT NULL DEFAULT 'public_data',
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_agent_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_conversations" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "profile_id" TEXT,
  "profile_key" TEXT NOT NULL DEFAULT 'market_analyst',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "selected_venue" TEXT NOT NULL DEFAULT 'auto',
  "selected_exchange_account_id" TEXT,
  "market_type" TEXT,
  "symbol" TEXT,
  "summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "blocks" JSONB,
  "source_refs" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_runs" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "profile_snapshot" JSONB NOT NULL,
  "context_snapshot" JSONB NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "tool_iterations" INTEGER NOT NULL DEFAULT 0,
  "tool_call_count" INTEGER NOT NULL DEFAULT 0,
  "usage_total_tokens" INTEGER,
  "latency_ms" INTEGER,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_agent_tool_calls" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "venue" TEXT,
  "exchange_account_id" TEXT,
  "arguments_summary" JSONB,
  "result_summary" JSONB,
  "duration_ms" INTEGER,
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_agent_profiles_user_id_name_key" ON "ai_agent_profiles"("user_id", "name");
CREATE INDEX "ai_agent_profiles_user_id_updated_at_idx" ON "ai_agent_profiles"("user_id", "updated_at" DESC);
CREATE INDEX "ai_agent_conversations_user_id_last_message_at_idx" ON "ai_agent_conversations"("user_id", "last_message_at" DESC);
CREATE INDEX "ai_agent_messages_conversation_id_created_at_idx" ON "ai_agent_messages"("conversation_id", "created_at");
CREATE INDEX "ai_agent_runs_user_id_created_at_idx" ON "ai_agent_runs"("user_id", "created_at" DESC);
CREATE INDEX "ai_agent_runs_conversation_id_created_at_idx" ON "ai_agent_runs"("conversation_id", "created_at");
CREATE INDEX "ai_agent_tool_calls_run_id_created_at_idx" ON "ai_agent_tool_calls"("run_id", "created_at");
CREATE INDEX "ai_agent_tool_calls_tool_name_created_at_idx" ON "ai_agent_tool_calls"("tool_name", "created_at" DESC);

ALTER TABLE "ai_agent_profiles" ADD CONSTRAINT "ai_agent_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_conversations" ADD CONSTRAINT "ai_agent_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_conversations" ADD CONSTRAINT "ai_agent_conversations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "ai_agent_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_agent_messages" ADD CONSTRAINT "ai_agent_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_agent_tool_calls" ADD CONSTRAINT "ai_agent_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
