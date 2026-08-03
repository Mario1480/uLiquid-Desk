# 00 – Repository Assessment und Gap Analyse

## Zweck

Diese Bestandsaufnahme wurde gegen den hochgeladenen Projektstand geprüft. Vor Implementierung muss Codex die Dateien erneut lesen und Unterschiede dokumentieren.

## Vorhandene AI-Architektur

### Tool-Registry

`apps/api/src/ai/tools/index.ts`

Aktuell registriert:

- `get_ohlcv`
- `get_indicators`
- `get_ticker`
- `get_orderbook`

Die Tool-Definitionen, Zod-Schemas, Cache, Timeout, Rate Limit und Tool-Iterationsgrenzen sind bereits vorhanden. Die Ausführung ist jedoch direkt an `apps/api/src/ai/tools/binance.ts` gekoppelt. Beschreibungen nennen ausdrücklich Binance.

### Agent Runtime

`apps/api/src/ai/agent.ts`

Der bestehende Runtime-Loop:

- baut eine serverseitige Security Boundary,
- ruft `callAiChat` mit Tools auf,
- verarbeitet Tool Calls,
- begrenzt Iterationen,
- validiert abschließend ein striktes `AgentSignal`-Schema.

Diese Runtime ist für Prediction-/Market-Signale geeignet, nicht direkt als allgemeiner Chat. Wiederverwendbar sind Tool-Loop, Limits, Logging und Provider-Integration. Das feste Signal-Output-Schema darf nicht für den neuen Chat übernommen werden.

### Tool Policy

`apps/api/src/ai/safety/toolPolicy.ts`

Aktuelle Scopes:

- `market_analysis`
- `prediction_builder`
- `position_monitoring`

Bereits vorhanden:

- callable/workflow Allowlist,
- harte Forbidden Execution Tools,
- Prompt-Injection-Systemblock,
- Output-Boundary-Check,
- Secret-Redaction,
- Laufzeitlimits.

Lücke: kein Scope für allgemeinen Agent Chat, Portfolio Reads oder Trade Planning Drafts.

## Prediction Builder

`apps/web/app/strategies/page.tsx` und `apps/api/src/strategies/routes-write.ts`

Der Builder ist bereits als spezialisierter Chat umgesetzt. Er sollte nicht in den Agent Chat integriert oder umbenannt werden. Gemeinsame UI-Primitives und Provider-Infrastruktur dürfen wiederverwendet werden.

## Position Copilot

`apps/api/src/position-copilot/`

Bereits produktnah vorhanden:

- striktes Snapshot-Schema,
- serverseitige Account-Ownership-Prüfung,
- deterministische Risikoanalyse,
- optionale AI-Erweiterung ohne Tools,
- Cache und Rate Limit,
- Dedupe und Notification Trigger,
- `AiTraceLog`,
- read-only UI im Trading Desk.

Wichtig: Der neue Agent Chat darf keinen zweiten Position-Risk-Algorithmus implementieren. Für Agent Skills soll die deterministische Logik aus `core.ts` wiederverwendet werden. Eine verschachtelte AI-Analyse „Agent ruft Position Copilot AI auf“ vermeiden.

## Exchange-Architektur

### `packages/exchange`

Geeignet für öffentliche Spot-Marktdaten:

- Binance Spot Client,
- CCXT Spot Client,
- Ticker, Orderbook, Trades, OHLCV,
- Symbolnormalisierung.

### `packages/futures-exchange`

Geeignet für:

- Exchange Account und Position Reads,
- Order-/Execution-Abstraktion,
- Capability Matrix,
- Bitget, Binance, BingX, Hyperliquid, MEXC, Paper.

Lücke: Das gemeinsame `FuturesExchange`-Interface stellt nicht alle öffentlichen Research-Daten wie OHLCV, Funding, Open Interest und Orderbook einheitlich bereit, obwohl einzelne Market-API-Implementierungen vorhanden sind.

## Market Intelligence

`apps/api/src/services/marketIntelligence/`

Bereits vorhanden:

- Provider Registry,
- News,
- Economic Calendar,
- Degraded-/Circuit-Breaker-Logik,
- normalisierte Verträge.

Der Agent Chat sollte diese Services direkt über Skills konsumieren und keine zweite News-/Kalender-Integration aufbauen.

## Datenbank

Vorhanden:

- `AiTraceLog`
- `ExchangeAccount`
- `UserAiPromptTemplate`
- Predictions und Prediction State

Fehlend für einen persistenten Agent Chat:

- Conversations,
- Messages,
- Agent Profiles,
- Tool Call Activity,
- optional spätere Action Drafts.

## Web-App

Navigation und App-Shell sind zentral vorhanden:

- `AppSidebar.tsx`
- `AppHeader.tsx`
- `AppBreadcrumbs.tsx`
- `AppIcon.tsx`
- Styles unter `apps/web/app/styles` und `ui-system.css`
- i18n unter `apps/web/messages/de` und `en`

Lücke: eigener Route-Bereich, Conversation History, Context Bar, Skills/Permissions Drawer, Activity Stream und mobile Layouts.

## Hauptrisiken

1. Doppelte Exchange-Implementierung.
2. Vermischung von Prediction Builder und operativem Agent Chat.
3. Freie Account IDs in Tool-Argumenten.
4. Direkter Adapterzugriff aus dem LLM-Loop.
5. Nested AI Calls über Position Copilot.
6. Tool-Ergebnisse ohne Source/Freshness.
7. Zu große Tool-Payloads und unkontrollierte Kosten.
8. UI-Feature-Gates ohne Server-Enforcement.
9. Stille Fallbacks zwischen Börsen bei positionsbezogenen Analysen.
10. Aktivierung von Trade Drafts, bevor Read-only-Sicherheit und Audit stabil sind.
