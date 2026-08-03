# 11 – API- und Datenverträge

## Prisma – MVP Vorschlag

Namenskonventionen an bestehendes Schema anpassen.

```prisma
model AiAgentProfile {
  id                        String   @id @default(cuid())
  userId                    String?  @map("user_id")
  user                      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  systemKey                 String?  @map("system_key")
  name                      String
  description               String?
  baseProfileKey            String   @map("base_profile_key")
  enabledSkillIds           String[] @default([]) @map("enabled_skill_ids")
  allowedExchangeAccountIds String[] @default([]) @map("allowed_exchange_account_ids")
  preferredVenue            String   @default("auto") @map("preferred_venue")
  preferredMarketType       String?  @map("preferred_market_type")
  actionLevel               String   @default("public_data") @map("action_level")
  version                   Int      @default(1)
  isDefault                 Boolean  @default(false) @map("is_default")
  createdAt                 DateTime @default(now()) @map("created_at")
  updatedAt                 DateTime @updatedAt @map("updated_at")

  conversations AiAgentConversation[]

  @@unique([userId, name])
  @@unique([systemKey])
  @@index([userId, updatedAt(sort: Desc)])
  @@map("ai_agent_profiles")
}

model AiAgentConversation {
  id                        String   @id @default(cuid())
  userId                    String   @map("user_id")
  user                      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  profileId                 String?  @map("profile_id")
  profile                   AiAgentProfile? @relation(fields: [profileId], references: [id], onDelete: SetNull)
  title                     String
  status                    String   @default("active")
  selectedVenue             String   @default("auto") @map("selected_venue")
  selectedExchangeAccountId String?  @map("selected_exchange_account_id")
  marketType                String?  @map("market_type")
  symbol                    String?
  summary                   String?
  createdAt                 DateTime @default(now()) @map("created_at")
  updatedAt                 DateTime @updatedAt @map("updated_at")
  lastMessageAt             DateTime @default(now()) @map("last_message_at")

  messages AiAgentMessage[]
  runs     AiAgentRun[]

  @@index([userId, lastMessageAt(sort: Desc)])
  @@map("ai_agent_conversations")
}

model AiAgentMessage {
  id             String   @id @default(cuid())
  conversationId String   @map("conversation_id")
  conversation   AiAgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String
  content        String
  blocks         Json?
  sourceRefs     Json?    @map("source_refs")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([conversationId, createdAt])
  @@map("ai_agent_messages")
}

model AiAgentRun {
  id                  String   @id @default(cuid())
  conversationId      String   @map("conversation_id")
  conversation        AiAgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  userId              String   @map("user_id")
  scope               String
  status              String
  profileSnapshot     Json     @map("profile_snapshot")
  contextSnapshot     Json     @map("context_snapshot")
  provider            String?
  model               String?
  toolIterations      Int      @default(0) @map("tool_iterations")
  toolCallCount       Int      @default(0) @map("tool_call_count")
  usageTotalTokens    Int?     @map("usage_total_tokens")
  latencyMs           Int?     @map("latency_ms")
  errorCode           String?  @map("error_code")
  createdAt           DateTime @default(now()) @map("created_at")
  completedAt         DateTime? @map("completed_at")

  toolCalls AiAgentToolCall[]

  @@index([userId, createdAt(sort: Desc)])
  @@index([conversationId, createdAt])
  @@map("ai_agent_runs")
}

model AiAgentToolCall {
  id                String   @id @default(cuid())
  runId             String   @map("run_id")
  run               AiAgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  toolName          String   @map("tool_name")
  status            String
  venue             String?
  exchangeAccountId String?  @map("exchange_account_id")
  argumentsSummary  Json?    @map("arguments_summary")
  resultSummary     Json?    @map("result_summary")
  durationMs        Int?     @map("duration_ms")
  errorCode         String?  @map("error_code")
  createdAt         DateTime @default(now()) @map("created_at")

  @@index([runId, createdAt])
  @@index([toolName, createdAt(sort: Desc)])
  @@map("ai_agent_tool_calls")
}
```

## Hinweise zum Schema

- Built-in Profile können als DB-Systemprofile oder Code-Registry umgesetzt werden. Code-Registry reduziert Migrationen; Nutzerprofile speichern nur Overrides. Codex soll nach Prüfung entscheiden.
- `allowedExchangeAccountIds` als Array ist für MVP einfach. Bei komplexeren Freigaben später Relationstabelle verwenden.
- `AiTraceLog` weiterhin für übergreifende AI-Observability verwenden oder `AiAgentRun` damit referenzieren. Keine doppelte Vollpayload speichern.
- User-Modell um Relations ergänzen.
- Migration additiv und rollback-sicher.

## Tool Context

```ts
type AgentSkillExecutionContext = {
  userId: string;
  runId: string;
  conversationId: string;
  locale: "de" | "en";
  selectedVenue: string | "auto";
  selectedExchangeAccountId: string | null;
  profile: ResolvedAgentProfile;
  budget: AgentRunBudget;
  signal: AbortSignal;
};
```

## Normalized Tool Result

```ts
type AgentToolResult<T> = {
  ok: boolean;
  data: T | null;
  meta: {
    toolId: string;
    sourceVenue?: string;
    sourceProvider?: string;
    observedAt?: string;
    fetchedAt: string;
    stale: boolean;
    degraded: boolean;
    fallbackUsed: boolean;
    cacheHit: boolean;
    warnings: string[];
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

## API DTO Grundsätze

- IDs als opaque strings.
- keine Secrets oder verschlüsselte Credential-Felder.
- Pagination für Conversations und Messages.
- Message-Längenlimit.
- Profile Skill IDs nur aus Registry.
- Account IDs auf User Ownership prüfen.
- UI erhält Capability Status pro Skill, um unavailable sauber anzuzeigen.
