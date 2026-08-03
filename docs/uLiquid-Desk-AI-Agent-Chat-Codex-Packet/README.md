# uLiquid Desk – AI Agent Chat Codex Work Package

Stand: 2026-08-02  
Basis: hochgeladener Projektstand `uLiquid-Desk-main.zip`

## Ziel

Dieses Paket beschreibt die schrittweise Umsetzung eines eigenständigen **AI Agent Chat** in uLiquid Desk. Der neue Bereich wird bewusst vom bestehenden Prediction Builder getrennt:

- **Prediction Builder:** erstellt, validiert und speichert Prediction-Strategien und Templates.
- **AI Agent Chat:** analysiert Märkte, Predictions, News, Wirtschaftsdaten, Konten und Positionen über auswählbare Skills.
- **Prediction Copier:** bleibt eine eigenständige, deterministische und vom Nutzer konfigurierte Automations-Runtime.
- **Execution:** bleibt außerhalb der freien AI-Tool-Schleife. In einer späteren Phase darf AI ausschließlich bestätigungspflichtige Entwürfe erstellen.

## Wichtigste Produktentscheidung

Keine Binance-spezifische Agentenlösung in den Produktkern einbauen. uLiquid Desk erhält eine eigene börsenübergreifende Skill-Schicht. Binance, Hyperliquid, Bitget, MEXC, BingX, Paper und spätere Anbieter sind Provider hinter stabilen internen Skill-Verträgen.

```text
User
  → AI Agent Chat
  → Agent Profile + Skill Policy
  → uLiquid Skill Registry
  → Market / Intelligence / Portfolio Services
  → vorhandene Exchange- und Domain-Module
  → normalisierte, auditierte Ergebnisse
```

## Verifizierter Ausgangspunkt im Repository

Bereits vorhanden und wiederzuverwenden:

- `apps/api/src/ai/provider.ts` – OpenAI-kompatible Provider-Anbindung.
- `apps/api/src/ai/agent.ts` – bestehender Tool-Loop für strukturierte Market-Signale.
- `apps/api/src/ai/tools/index.ts` – bestehende AI-Tool-Registry, derzeit Binance-hartcodiert.
- `apps/api/src/ai/tools/binance.ts` – öffentliche Binance-Marktdaten.
- `apps/api/src/ai/safety/toolPolicy.ts` – serverseitige Scopes, Tool-Allowlist und Secret-Redaction.
- `apps/api/src/position-copilot/` – read-only Position Copilot mit deterministischer Analyse, AI-Erweiterung, Cache, Dedupe und Audit.
- `packages/exchange` – öffentliche Spot-Daten, Binance-Client und CCXT-Client.
- `packages/futures-exchange` – Bitget, Binance, BingX, Hyperliquid, MEXC, Paper, Positionen und Execution.
- `apps/api/src/services/marketIntelligence/` – Provider-Registry für News und Wirtschaftskalender.
- `prisma/schema.prisma` – `AiTraceLog`, Exchange Accounts, Predictions und Nutzerbeziehungen.
- `apps/web/app/components/AppSidebar.tsx`, `AppHeader.tsx`, `AppBreadcrumbs.tsx` – Navigation.
- `apps/web/app/strategies/page.tsx` – bestehender Prediction Builder Chat.
- `apps/web/app/trade/page.tsx` – bestehende Position-Copilot-UI.

## Nicht-Ziele für den ersten Release

- keine autonome Orderausführung durch das Sprachmodell,
- keine Wallet-, Vault-, Billing-, API-Key- oder Admin-Tools,
- keine Änderung am Prediction Copier Execution Flow,
- kein Umbau der eigenen Payment- und Wallet-Lösung,
- kein Grid-Bot- oder Vault-Scope,
- kein ungeprüfter Zugriff auf beliebige Exchange Account IDs,
- keine direkten offiziellen Binance Skills als paralleler Trading-Pfad.

## Empfohlene Release-Reihenfolge

1. `01-foundation-and-feature-gates.md`
2. `02-multi-exchange-read-skills.md`
3. `03-agent-chat-runtime-and-conversations.md`
4. `04-agent-profiles-skills-permissions.md`
5. `05-agent-chat-ui-ux.md`
6. `06-position-copilot-integration.md`
7. `07-activity-audit-observability.md`
8. `08-security-hardening.md`
9. `09-testing-and-rollout.md`
10. optional später: `10-trade-drafts-and-approvals-future.md`

## MVP-Profile

### Market Analyst

Öffentliche Daten, keine Kontodaten:

- OHLCV
- Indikatoren
- Ticker
- Orderbuch
- Funding Rate
- Open Interest
- News
- Wirtschaftskalender
- Predictions

### Position Copilot

Zusätzlich serverseitig gebundener Read-only-Zugriff auf ausgewählte Nutzerkonten und Positionen. Keine Orders und keine Konfigurationsänderungen.

### Trading Assistant – spätere Phase

Darf nur validierte Action Drafts erzeugen. Der Nutzer muss jeden Draft in einem separaten Review-Flow bestätigen. Der Agent erhält weiterhin keinen direkten Execution-Adapter.

## Arbeitsregeln für Codex

- Zuerst `AGENTS.md`, die betroffenen Module und vorhandenen Tests lesen.
- Vor Änderungen `git status --short --branch` prüfen.
- Fremde Working-Tree-Änderungen respektieren.
- Kleine, nachvollziehbare Commits bzw. Arbeitsschritte.
- Bestehende Architektur erweitern statt duplizieren.
- Jede neue Route: Auth, Ownership, Zod-Schema, Rate Limit, Audit und stabile Fehlercodes.
- Alle sichtbaren Texte in Deutsch und Englisch.
- Desktop, Tablet und Mobile berücksichtigen.
- Loading-, Empty-, Error-, Degraded- und Permission-Denied-Zustände umsetzen.
- Keine Secrets in Prompts, Tool-Ergebnissen oder Logs.
- Jede AI-Tool-Antwort enthält Source-, Freshness- und Degraded-Metadaten.

## Paketinhalt

- `CODEX-MASTER-PROMPT.md` – übergreifender Auftrag.
- `00-repository-assessment.md` – verifizierter Ist-Zustand und Lücken.
- `01` bis `10` – umsetzbare Agenten-Arbeitspakete.
- `11-api-and-data-contracts.md` – vorgeschlagene Verträge und Prisma-Modelle.
- `12-codex-agent-workstreams.md` – Parallelisierung und Abhängigkeiten.
- `13-definition-of-done.md` – finale Akzeptanz- und Release-Checkliste.
- `references/ai-agent-chat-mockup.png` – visuelle Referenz, nicht pixelgenau nachbauen.
