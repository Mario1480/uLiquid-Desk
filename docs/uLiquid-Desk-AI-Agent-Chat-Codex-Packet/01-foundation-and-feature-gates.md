# Agent 01 – Foundation, Modulgrenzen und Feature Gates

## Auftrag

Schaffe die technische Grundlage für den separaten AI Agent Chat, ohne bestehende AI-, Trading- oder Prediction-Flows zu verändern.

## Zielstruktur

```text
apps/api/src/ai/agent-chat/
  contracts.ts
  schemas.ts
  policy.ts
  runtime.ts
  context.ts
  routes.ts
  service.ts
  errors.ts

apps/web/app/agent-chat/page.tsx
apps/web/components/agent-chat/
apps/web/src/agent-chat/
apps/web/messages/de/agentChat.json
apps/web/messages/en/agentChat.json
```

Die endgültige Struktur darf an bestehende Repo-Konventionen angepasst werden. Keine große Verschiebung bestehender Dateien als Voraussetzung.

## Aufgaben

### 1. Neue Produktgrenze

- Neue Route `/agent-chat`.
- Prediction Builder bleibt `/strategies`.
- Keine gemeinsame Chat-History zwischen Builder und Agent Chat.
- Eigene API-Routen unter `/api/agent-chat`.
- Eigener AI Scope, mindestens:
  - `agent_market`
  - `agent_position`
  - optional später `agent_trade_planning`

### 2. Feature Gates

Neue serverseitige Gates:

- `ai_agent_chat`
- `ai_agent_account_reads`
- `ai_agent_custom_profiles`
- `ai_agent_trade_drafts` – default aus

An vorhandene Product-Feature-/License-Infrastruktur anbinden. Admins dürfen Preview-Zugriff erhalten, aber Server-Gates bleiben aktiv.

### 3. Runtime Contracts

Definiere:

```ts
type AgentChatMode = "market" | "position" | "trade_planning";
type AgentAccessLevel = "public_data" | "account_read" | "draft_actions";
type AgentConversationStatus = "active" | "archived";
```

Der MVP unterstützt nur `market` und `position`.

### 4. Fehlercodes

Mindestens:

- `agent_chat_feature_disabled`
- `agent_chat_profile_not_found`
- `agent_chat_skill_not_allowed`
- `agent_chat_account_access_denied`
- `agent_chat_venue_unsupported`
- `agent_chat_market_data_degraded`
- `agent_chat_tool_budget_exceeded`
- `agent_chat_provider_unavailable`
- `agent_chat_conversation_not_found`
- `agent_chat_message_invalid`

### 5. API-Bootstrap

Agent Chat als eigenes Modul registrieren. `apps/api/src/index.ts` nur für Wiring verwenden, keine neue Domänenlogik dort ablegen.

## Sicherheitsanforderungen

- Account Reads nur bei aktiviertem Gate und expliziter Nutzerberechtigung.
- Feature Gate serverseitig vor Laden von Conversation/Profile/Tools prüfen.
- Kein Execution Tool registrieren.
- `AI_FORBIDDEN_EXECUTION_TOOLS` unverändert bzw. erweitert lassen.

## Tests

- Route ist bei deaktiviertem Gate serverseitig blockiert.
- Market Profile funktioniert ohne Exchange Account.
- Position Profile verlangt Account-Read-Gate.
- Prediction Builder Routes und Scopes bleiben unverändert.
- unbekannter Scope und unbekannte Tools werden fail closed abgelehnt.

## Akzeptanzkriterien

- Agent Chat besitzt eine klar getrennte Modulgrenze.
- Keine Regression im Prediction Builder.
- Keine UI-only-Sicherheit.
- Leere Route kann kontrolliert hinter Feature Gate ausgeliefert werden.
