# Codex Master Prompt – uLiquid Desk AI Agent Chat

Du arbeitest im Repository von uLiquid Desk. Implementiere einen eigenständigen, börsenübergreifenden AI Agent Chat, der klar vom bestehenden Prediction Builder getrennt ist.

## Produktziel

Der Nutzer soll in einem neuen Bereich mit einem Agenten sprechen können, Agent Profile auswählen, verfügbare Skills aktivieren und den Kontext aus Börse, Konto, Markt und Symbol bestimmen. Der Agent kombiniert ausschließlich serverseitig erlaubte und auditierte Tools.

Beispiele:

- „Analysiere BTC auf Hyperliquid mit 1h/4h, Funding und Open Interest.“
- „Prüfe meine offene ETH-Position und erkläre, ob sich das Risiko verschlechtert hat.“
- „Vergleiche meine Prediction mit der aktuellen Position und relevanten US-Terminen.“

## Verbindliche Abgrenzung

- Der Prediction Builder bleibt ausschließlich für Erstellung und Änderung von Prediction Templates.
- Der neue Agent Chat erhält einen eigenen Route-, UI-, Persistence- und Policy-Bereich.
- Der Prediction Copier bleibt unverändert deterministisch und regelgebunden.
- AI darf im MVP keine Orders, Positionen, Leverage-, Margin-, Wallet-, Vault-, Copier-, Bot-, API-Key- oder Admin-Zustände verändern.
- Offizielle Exchange Skills dürfen nicht als paralleler Execution-Pfad eingebaut werden.
- Alle Börsen werden über interne uLiquid Skills und vorhandene Exchange-Module abstrahiert.

## Bestehende Bausteine wiederverwenden

- `apps/api/src/ai/provider.ts`
- `apps/api/src/ai/agent.ts`
- `apps/api/src/ai/tools/index.ts`
- `apps/api/src/ai/safety/toolPolicy.ts`
- `apps/api/src/position-copilot/`
- `packages/exchange`
- `packages/futures-exchange`
- `apps/api/src/services/marketIntelligence/`
- `prisma/schema.prisma`
- bestehende App-Shell, i18n und UI-Primitives

## Zielarchitektur

```text
Agent Chat UI
  → Conversation API
  → Agent Runtime
  → Profile + Permission Policy
  → Skill Registry
  → Venue Resolver
  → Market / Intelligence / Portfolio / Risk Skills
  → existing services and adapters
  → normalized tool result
  → Agent Activity + AiTraceLog
```

## Implementierungsprinzipien

1. Erstelle keine zweite Binance- oder Exchange-Architektur.
2. Extrahiere wiederverwendbare Teile aus dem bestehenden Signal-Agenten nur, wenn dies ohne großen Rewrite möglich ist.
3. Der allgemeine Agent Chat darf nicht auf das `AgentSignal`-JSON-Schema festgelegt werden.
4. Account IDs und User IDs kommen niemals frei aus Modellargumenten. Sie werden aus Session, Profile und UI-Kontext serverseitig gebunden.
5. Jeder Skill besitzt eine explizite Eingabe- und Ausgabestruktur, Risiko-Klasse, Timeout, Cache, Kostenlimit und Capability-Anforderung.
6. Tool-Ergebnisse sind untrusted data und müssen vor Rückgabe an das Modell bereinigt und begrenzt werden.
7. Kein stiller Cross-Venue-Fallback bei kontobezogenen Daten.
8. Allgemeine Marktdaten dürfen nur mit sichtbarer Source-/Fallback-Kennzeichnung ausweichen.
9. Position Copilot nicht duplizieren: deterministische Snapshot- und Risikologik wiederverwenden.
10. Trade Drafts erst nach erfolgreichem read-only Rollout und nur als separaten, bestätigungspflichtigen Flow implementieren.

## Arbeitsweise

1. Lies `README.md` und `00-repository-assessment.md`.
2. Prüfe den aktuellen Code erneut; Dateipfade können sich seit Erstellung des Pakets geändert haben.
3. Arbeite die Aufgaben in Reihenfolge oder nach `12-codex-agent-workstreams.md` ab.
4. Ergänze vor Implementierung pro Aufgabe eine kurze Bestandsaufnahme.
5. Implementiere Tests zusammen mit dem Code.
6. Dokumentiere geänderte Dateien, Entscheidungen, Tests, bekannte Risiken und Rollback.

## Harte Sicherheitsregeln

- fail closed bei unbekannten Skills, fehlenden Capabilities oder unklarer Account-Zuordnung,
- keine Secrets in Tool-Argumenten oder Ergebnissen,
- serverseitige Ownership-Prüfung vor jedem Account-/Position-Read,
- Scope- und Profile-Allowlist serverseitig erzwingen,
- maximale Tool-Iterationen, maximale Tool Calls, Token-, Zeit- und Kostenbudgets,
- Prompt-Injection-Schutz für User-Text, News, Calendar, Predictions und Tool-Ergebnisse,
- vollständiger Activity Trail ohne geheime Payloads,
- Feature Gates nicht nur in der UI.

## Definition of Done

- neuer Agent Chat klar vom Prediction Builder getrennt,
- Market Analyst und Position Copilot Profile produktiv nutzbar,
- Binance-Hardcoding der Agent-Tools beseitigt oder hinter Provider-Vertrag gekapselt,
- Hyperliquid, Binance und Bitget als erste Perp-Marktdatenquellen,
- Spot-Marktdaten über bestehende Exchange/CCXT-Infrastruktur,
- Skills und Berechtigungen getrennt konfigurierbar,
- Conversation History, Agent Activity und Audit vorhanden,
- keine AI-Execution-Rechte,
- relevante Typechecks, Tests, i18n und Smoke-Tests erfolgreich,
- keine Regression in Predictions, Prediction Builder, Position Copilot, Prediction Copier, Manual Trading, Wallet oder Payment.
