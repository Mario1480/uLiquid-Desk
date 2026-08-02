# AI Safety and Tool Matrix

Stand: 2026-08-02

## Geltungsbereich

Diese Matrix erfasst alle callable AI-Tools und AI-nahen Workflow-Operationen der Limited Beta. Sie gilt für Market Analysis, den Prediction Builder und Position Monitoring. Der Prediction Copier ist ausdrücklich kein AI-Agent und besitzt keine AI-Tool-Registry.

## Agentenmatrix

| Scope | Callable Provider-Tools | Workflow-Operationen | Erlaubte Daten | Schreibwirkung durch AI | Server Enforcement |
| --- | --- | --- | --- | --- | --- |
| `market_analysis` | `get_ohlcv`, `get_indicators`, `get_ticker`, `get_orderbook` | keine | öffentliche Marktdaten und im Request bereitgestellte Prediction-Historie | keine | `apps/api/src/ai/safety/toolPolicy.ts`, `apps/api/src/ai/tools/index.ts`, `apps/api/src/ai/agent.ts` |
| `prediction_builder` | keine | `create_template_draft`, `update_template_draft`, `validate_template_draft`, `explain_template_field`, `request_preview` | eigener Template-Draft und öffentlicher Indikator-Katalog | nur Draft/Preview; Speicherung ausschließlich nach expliziter Bestätigung | `apps/api/src/ai/safety/toolPolicy.ts`, `apps/api/src/ai/predictionTemplateDraft.ts`, `apps/api/src/strategies/routes-write.ts` |
| `position_monitoring` | keine | `draft_notification` | serverseitig dem User zugeordneter Position-Snapshot, Marktkontext und Notification Draft | keine Trading-Wirkung; Notification erst nach deterministischem Trigger | `apps/api/src/ai/safety/toolPolicy.ts`, `apps/api/src/position-copilot/service.ts`, `apps/api/src/position-copilot/routes.ts` |

## Callable Tool Inventory

### `get_ohlcv`

- Quelle: öffentliche Binance Spot-/Perpetual-Marktdaten
- Argumente: Symbol, Intervall, Limit, Market Type
- Grenzen: striktes Zod-Schema, Timeout, Cache, Rate Limit
- Side Effects: keine

### `get_indicators`

- Quelle: deterministische Berechnung aus öffentlichen OHLCV-Daten
- Argumente: Symbol, Intervall, Lookback, Indikator-Allowlist, Market Type
- Grenzen: striktes Zod-Schema, Lookback-/Listenlimits, Timeout, Cache, Rate Limit
- Side Effects: keine

### `get_ticker`

- Quelle: öffentlicher Binance-Ticker
- Argumente: Symbol und Market Type
- Grenzen: striktes Zod-Schema, Timeout, Cache, Rate Limit
- Side Effects: keine

### `get_orderbook`

- Quelle: öffentliches Binance Orderbook
- Argumente: Symbol, Tiefe und Market Type
- Grenzen: striktes Zod-Schema, Tiefenlimit, Timeout, Cache, Rate Limit
- Side Effects: keine

Andere oder erfundene Tool-Namen werden serverseitig abgelehnt. Insbesondere existieren keine Order-, Positions-, Leverage-, Margin-, Wallet-, Vault-, Copier-Konfigurations-, Bot-Start-, API-Key- oder Admin-Schreibtools in einer AI-Registry.

## Gemeinsame technische Grenzen

- Jede AI-Anfrage erhält einen serverseitig erzeugten Scope-Block. User Messages, gespeicherte Texte, News und Tool-Ergebnisse werden darin als untrusted data klassifiziert und können die Systemgrenze nicht überschreiben.
- Der Market-Agent kann höchstens drei Tool-Iterationen und 1.600 Output-Tokens nutzen. Übergroße Caller-Werte werden auf die Policy-Grenze reduziert.
- Der Prediction Builder besitzt keinen freien Tool-Loop und maximal 1.800 Output-Tokens. AI-Ausgaben sind ausschließlich Draft-Vorschläge und werden erneut normalisiert und validiert.
- Position Monitoring besitzt keine callable Tools, maximal 650 Output-Tokens sowie zusätzlich Cache und AI-Rate-Limit.
- Unbekannte oder execution-nahe Output-Felder führen zu einem fail-closed Fallback beziehungsweise zur Ablehnung.
- AI Trace Payloads und Responses werden rekursiv um Credential-, Token-, Private-Key-, Passphrase-, Seed- und Authorization-Felder bereinigt.
- User- und Account-Zuordnung wird vor AI-Aufrufen beziehungsweise vor persistierten Zugriffen serverseitig geprüft.

## Human Confirmation

- Builder Chat und Preview erzeugen keine Prediction, Order oder Copier-Konfiguration.
- Das Speichern eines Prediction Templates erfordert `confirmed: true` und `acknowledgedAnalysisOnly: true`.
- Prediction-Copier-Erstellung und -Aktivierung bleiben separate Nutzeraktionen mit bestehender Aktivierungsbestätigung.
- AI-Ausgaben können weder Templates stillschweigend speichern noch einen Copier aktivieren oder Regeln verändern.

## Prediction Copier Boundary

Der Prediction Copier liest persistierte, validierte `PredictionState`-Records und führt keinen AI-Tool-Loop aus. Der Datenbank-Lookup ist auf User und Exchange-Konto begrenzt; der Runner prüft dieselbe Zuordnung zusätzlich im Evaluator. Entscheidungen folgen ausschließlich der gespeicherten Nutzerkonfiguration, globalem und nutzerbezogenem Kill Switch, Prediction-Alter, Confidence, Tags, Cooldown, Trade-Caps, Leverage, Daily Loss sowie Symbol- und Gesamt-Notional-Grenzen. Zusätzliche AI-förmige Felder oder behauptete Risk-Gate-Overrides werden ignoriert und können diese Grenzen nicht überschreiben.
