# Premium Plan Gating – Stage 3: AI- und Capability-Gates

Stand: 2026-08-25

Status: **Stage-3-Code und zielgerichtete Tests verifiziert; Migration, Daten-Census, Backfill und Deployment nicht ausgeführt.**

## Freigegebener Umfang

Stage 3 aktiviert die in Stage 0 geplante Capability-Matrix für Grid, Prediction Copier, Market Intelligence und AI-Produkte. Die bereits in Stage 1 erstellte Migration wurde dabei weder ausgeführt noch verändert. Es wurden keine Daten geschrieben, keine Pakete angelegt oder aktiviert und keine Umgebung deployt.

## Implementierte Capability-Matrix

| Produktfläche | Free | Pro | Premium | Enterprise |
| --- | --- | --- | --- | --- |
| Grid Bots | erlaubt | erlaubt | erlaubt | erbt Premium |
| Prediction Copier | erlaubt | erlaubt | erlaubt | erbt Premium |
| Erforderliche Grid-/Copier-Plugins | erlaubt | erlaubt | erlaubt | erbt Premium |
| AI Predictions | gesperrt, Teaser erst Stage 5 | erlaubt | erlaubt | erbt Premium |
| AI Prediction Builder | gesperrt | erlaubt | erlaubt | erbt Premium |
| Full Market Intelligence | gesperrt, Teaser erst Stage 5 | erlaubt | erlaubt | erbt Premium |
| Agent Chat / Market Analyst | gesperrt | erlaubt | erlaubt | erbt Premium |
| Private Account Reads | gesperrt | gesperrt | erlaubt plus Operator-Gate | erbt Premium |
| Position Copilot | gesperrt | gesperrt | erlaubt plus Operator-Gates | erbt Premium |
| Position Monitoring | gesperrt | gesperrt | erlaubt plus eigenes Operator-Gate | erbt Premium |
| Multi-Exchange Private Analysis | gesperrt | gesperrt | erlaubt plus eigenes Operator-Gate | erbt Premium |
| Custom Agent Profiles | gesperrt | gesperrt | erlaubt plus Operator-Gate | erbt Premium |
| Advanced Market Intelligence | gesperrt | gesperrt | Capability vorhanden | erbt Premium |

Enterprise bleibt ein eigener, höher gerankter Plan. Die Enterprise-Defaults erben das Premium-Capability-Envelope; explizite persistierte Overrides werden weiterhin vom gemeinsamen Resolver darübergelegt.

Für Advanced Market Intelligence existiert aktuell keine separat ausführbare User-Route. Die neue Premium-Capability bildet die kommerzielle Grenze zentral ab, ohne eine noch nicht vorhandene Produktoberfläche zu erfinden.

## Zentrale Capability- und Plugin-Schicht

Die gemeinsamen Capability-Keys und Product-Feature-Definitionen wurden um folgende enge Gates ergänzt:

- `product.market_intelligence`
- `product.market_intelligence_advanced`
- `product.ai_prediction_builder`
- `product.ai_position_copilot`
- `product.ai_position_monitoring`
- `product.ai_multi_exchange_analysis`

Die bereits vorhandenen Gates `product.ai_agent_account_reads` und `product.ai_agent_custom_profiles` wurden aus dem Pro-Default entfernt und dem Premium-Default zugeordnet. `product.ai_agent_trade_drafts` bleibt standardmäßig geschlossen.

Free erhält jetzt zentral:

- `product.grid_bots`
- `execution.mode.grid`
- `strategy.kind.futures_grid`
- `strategy.kind.prediction_copier`

Die API- und Runner-Manifeste der vollständigen Laufzeitkette wurden ebenfalls auf Free gesetzt:

- `core.signal.prediction_copier`
- `core.execution.grid`
- `core.execution.futures_grid`
- `core.execution.prediction_copier`
- `core.signal_source.prediction_state`

DCA, Dip Reversion und andere Pro-Plugins bleiben unverändert kostenpflichtig. Neue Free-Policy-Snapshots enthalten die erforderlichen Capability-Werte und Plugin-IDs; bestehende alte Snapshots bleiben lesbar. Es wurde kein Snapshot-Backfill ausgeführt.

## Serverseitige Durchsetzung

### Market Intelligence

Die User-Routen für Context, Summary und Provider-Status verlangen `product.market_intelligence`. Admin-Preview darf das Plan-Gate wie bisher umgehen. Allgemeine News-Detail-Reads bleiben außerhalb dieses Full-Market-Intelligence-Gates.

### AI Prediction Builder

Eigene Builder-, Generate-, Chat-, Save-, Update- und Delete-Pfade verwenden jetzt `product.ai_prediction_builder` statt des breiten AI-Prediction-Gates. Die allgemeine AI-Predictions-Fläche bleibt separat über `product.ai_predictions` geschützt.

### Agent Chat und Profile

Pro kann das Built-in-Profil Market Analyst und dessen Public-Market-Skills verwenden. Das Position-Copilot-Profil wird in der serverseitigen Profilauflistung für Pro nicht mehr ausgeliefert und bei direkter Auswahl erneut serverseitig geprüft. Custom Profiles, Account Reads und Multi-Exchange-Auswahl benötigen jeweils ihre eigene Premium-Capability.

Eine benutzerdefinierte Profilkonfiguration mit mehr als einem Exchange Account verlangt zusätzlich `product.ai_multi_exchange_analysis`. Die vorhandene Ownership-Prüfung aller übergebenen Account-IDs bleibt erhalten.

### Direkter Trade-Desk Position Copilot

Die direkten Settings- und Analyze-Endpunkte verlangen `product.ai_position_copilot`. Nicht-manuelle Analysen und das Aktivieren eines Monitoring-Modus verlangen zusätzlich `product.ai_position_monitoring`. Die Account-Abfrage bleibt auf `account.id` plus authentifizierte `userId` begrenzt.

## Operator- und Security-Gates

Plan-Capabilities allein aktivieren private AI-Funktionen nicht. Zusätzlich gelten:

- `AI_AGENT_CHAT_ENABLED`, `AI_MODEL_ROUTER_V1`, `AI_RESPONSES_API_AGENT`
- `AI_AGENT_ACCOUNT_READS_ENABLED`
- `AI_AGENT_CUSTOM_PROFILES_ENABLED`
- `AI_POSITION_COPILOT_ENABLED`
- `AI_POSITION_MONITORING_ENABLED`
- `AI_AGENT_MULTI_EXCHANGE_ANALYSIS_ENABLED`
- `AI_AGENT_TRADE_DRAFTS_ENABLED=false`

Die drei neuen privaten Runtime-Flags sind im Production-Beispiel standardmäßig `false`. Ein Admin-Plan-Bypass umgeht kein deaktiviertes Environment-/Security-Master-Gate.

Die bestehende read-only Tool-Policy wurde nicht erweitert: Agent-Profile enthalten weiterhin keine Side-Effect-Tools, Draft Actions werden abgewiesen und autonome AI-Trades bleiben deaktiviert. AI-Credit-Prüfung und -Abrechnung bleiben von der Produkt-Capability getrennt; ein erlaubtes Produkt-Gate erzeugt keine Credits und umgeht keine Credit-Reservation.

## Frontend-Vertrag

Die Web-Feature-Keys spiegeln die zentrale Servermatrix und fehlende Gate-Werte failen jetzt geschlossen. Sidebar und Header verwenden für den Prediction Builder das eigene Builder-Gate. Grid wird über das gemeinsame `grid_bots`-Gate für Free sichtbar.

Market Intelligence bleibt in der Navigation auffindbar, damit Stage 5 dort den vorgesehenen Free-Teaser und die Upgrade-CTA ergänzen kann; Full-Data-Reads werden bereits serverseitig abgewiesen. Die sichtbaren Locked-/Teaser-Zustände, Pricing Cards und CTA-Ziele gehören weiterhin zu Stage 5 und wurden in Stage 3 nicht vorgezogen.

## Testnachweis

Verifiziert:

- `npm -w packages/core run typecheck` – erfolgreich
- `npm -w apps/api run typecheck` – erfolgreich
- `npm -w apps/runner run typecheck` – erfolgreich
- `npm -w apps/web run typecheck` – erfolgreich
- `npm -w apps/api run test:agent-chat` – 30/30 bestanden
- zielgerichtete Capability-, Strategy-, Market-Intelligence-, Position-Copilot-, Plugin-, License- und Web-Gate-Tests – 48/48 bestanden
- API→Policy-Snapshot→Runner-Plugin-Auflösung – 11/11 bestanden
- `npm -w apps/api run test:billing` – 106/106 bestanden
- bestehende Market-Intelligence-/News-/Calendar-Regressionsuite mit `--test-force-exit` – 55/55 bestanden
- `npm -w apps/runner run test` – 242/242 bestanden
- `git diff --check` – erfolgreich

Die bestehende Market-Intelligence-Package-Command beendet sich ohne `--test-force-exit` nach bestandenen Tests wegen offener Handles nicht selbst. Mit dem im Repository bereits verwendeten Force-Exit-Modus laufen alle 55 Tests erfolgreich durch. Das ist ein Test-Harness-Nachlaufproblem, kein beobachteter funktionaler Fehler der neuen Route-Gates.

## Nicht ausgeführt und weiterhin unbekannt

- Keine Prisma-Migration ausgeführt.
- Keine Datenbank-, Paket-, Term-, Subscription- oder Capability-Override-Writes.
- Kein Stage-4-Backfill.
- Kein Staging- oder Production-Deployment.
- Kein Commit oder Push.
- Kein read-only Live-Daten-Census; persistierte `GlobalSetting`-Capability-Overrides und tatsächlich gesetzte Production-Flags sind deshalb weiterhin unbekannt.

## Nächstes separates Gate

Stage 4 betrifft Package-/Term-Migration, bestehende Pro-Daten, Add-ons, AI-Credit-Kompatibilität und gegebenenfalls Backfills. Diese Schritte können Daten verändern und benötigen deshalb eine neue ausdrückliche Freigabe. Vor jeder Migration bleibt ein read-only Census der realen Plan-, Paket-, Term-, Override- und Add-on-Verteilung empfohlen.
