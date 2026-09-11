# 12 – Codex Agent Workstreams und Abhängigkeiten

## Ziel

Das Paket kann seriell oder mit mehreren Codex-Agenten umgesetzt werden. Parallelarbeit nur an klar getrennten Bereichen.

## Empfohlene Reihenfolge

```text
Agent 01 Foundation
  ├─ Agent 02 Multi-Exchange Skills
  ├─ Agent 03 Runtime/Persistence
  └─ Agent 04 Profiles/Permissions
          ↓
Agent 05 UI/UX
Agent 06 Position Copilot Integration
Agent 07 Activity/Audit
Agent 08 Security Review
Agent 09 Test/Rollout
```

Agent 10 Trade Drafts ist separat und nicht automatisch starten.

## Workstream A – Backend Foundation

Dateien:

- `apps/api/src/ai/safety/toolPolicy.ts`
- neuer `apps/api/src/ai/agent-chat/`
- API Bootstrap/Wiring
- Feature Gates

Lieferobjekt:

- leere, gegatete Agent Chat API,
- Scopes/Policies,
- Fehlercodes,
- Contracts.

## Workstream B – Market Data Skills

Dateien:

- neues `packages/market-data` oder dokumentierte Alternative,
- `packages/exchange`
- ausgewählte Market APIs in `packages/futures-exchange`
- `apps/api/src/ai/tools/index.ts`

Lieferobjekt:

- normalisierte read-only Skills,
- Venue Resolver,
- Tests für Binance/Hyperliquid/Bitget.

## Workstream C – Conversations und Profiles

Dateien:

- Prisma Schema/Migration,
- Agent Chat Service/Routes,
- Profile Policy,
- Conversation Store.

Lieferobjekt:

- persistente History,
- Built-in Profile,
- Skill/Permission Enforcement.

## Workstream D – Web UI

Erst starten, wenn API DTOs stabil sind.

Dateien:

- `/agent-chat`
- Komponenten/Hooks/View Models,
- Navigation,
- Styles,
- i18n.

Lieferobjekt:

- Market Analyst Flow,
- Position Profile Flow,
- Skills/Permissions Drawer,
- Activity Panel.

## Workstream E – Position Copilot

Dateien:

- `apps/api/src/position-copilot/core.ts`
- Agent risk skill,
- Trading Desk Deep Link,
- Tests.

Lieferobjekt:

- gemeinsame deterministische Analyse,
- kein nested AI.

## Workstream F – Observability/Security

Dateien:

- Run/Tool persistence,
- `AiTraceLog`,
- Redaction,
- Metrics,
- Security Tests,
- Docs.

## Konfliktregeln

- Nur ein Agent bearbeitet `toolPolicy.ts` gleichzeitig.
- Nur ein Agent bearbeitet Prisma Schema/Migration gleichzeitig.
- UI-Agent wartet auf DTO-Freeze.
- Exchange-Agent verändert keine Execution-Semantik.
- Security-Agent darf Findings patchen, aber nicht unkoordiniert Feature-Scope erweitern.

## Abschlussbericht je Agent

```text
## Geänderte Dateien
## Architekturentscheidungen
## Tests ausgeführt
## Ergebnisse
## Bekannte Restpunkte
## Risiken/Rollback
```
