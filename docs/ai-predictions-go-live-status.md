# AI Predictions Go-live Status

Stand: 2026-05-02

Diese Doku haelt den aktuellen Go-live-Status der AI Predictions fest. Sie ergaenzt `docs/prediction-refresh-scheduler.md`, `docs/prediction-evaluator.md` und `docs/ai-evaluation-framework.md`.

## Aktueller Status

Die AI-Predictions-Flaeche ist nach den letzten Hardening-Fixes deutlich naeher an einem kontrollierten Production-Canary. Die fuenf Review-Findings sind im Code adressiert:

- AI-Provider-Fallbacks und Rate-Limit-Fallbacks werden nicht mehr in den normalen AI-Cache geschrieben.
- AI-only bleibt fail-closed, weil Fallback-Metadaten nicht mehr durch Cache-Hits verloren gehen koennen.
- Der Performance-Evaluator bewertet Predictions mit dem persistierten `horizonMs` statt nur mit einem Timeframe-Intervall.
- Refresh-Fehler werden in `PredictionState` persistiert und in API/UI als degraded sichtbar.
- Tradable Generate-Flows laufen bei History-Persistenzfehlern fail-closed mit `503 prediction_persist_failed`.
- AI-Provider-Base-URLs werden vor Outbound-Fetches gehaertet; unsichere Ziele liefern generisch `503`.

Empfehlung: Ein interner Canary ist nach Migration und Provider-Konfig-Smoke vertretbar. Ein breiter Go-live sollte erst nach echten Scheduler-/Provider-Smokes, aktivem Monitoring und Operator-Runbook erfolgen.

## Behobene Go-live Blocker

### AI Cache und AI-only Semantik

Status:

- `analyzeWithAiGuards` cached nur noch erfolgreiche Provider-Ergebnisse.
- Provider-Fehler und Rate-Limits liefern weiterhin Fallbacks, aber ohne normalen Cache-Eintrag.
- Cache-Hits geben eindeutig `fallbackUsed=false` und `rateLimited=false` zurueck, weil sie nur noch echte Provider-Erfolge repraesentieren.
- Tests decken ab, dass Fallbacks nicht in einen spaeteren Cache-Hit fuer AI-only durchrutschen.

Warum das wichtig ist:

- AI-only Predictions koennen nicht mehr versehentlich ein lokales Fallback-Ergebnis als echtes AI-Signal akzeptieren.

### Performance-Evaluator-Horizont

Status:

- `close_to_close_v2` nutzt `row.horizonMs`.
- Fallback ist `timeframeMs * PREDICTION_OUTCOME_HORIZON_BARS`.
- Candidate-Filter, Candle-Fetch-Fenster, Horizon-Ende und `realizedReturnPct` verwenden denselben Horizont.
- Alte `close_to_close_v1` Rows werden wieder als Kandidaten behandelt und mit `close_to_close_v2` ueberschrieben.
- `outcomeMeta.realizedHorizonMs` wird persistiert.

Warum das wichtig ist:

- Hit-Rate, MAE, Calibration und Quality-Metriken messen jetzt den geplanten Prediction-Horizont statt nur den naechsten Candle.

### Refresh-Health

Neue persistente Felder auf `PredictionState`:

- `refreshStatus`
- `lastRefreshAttemptAt`
- `lastRefreshErrorAt`
- `lastRefreshError`
- `refreshFailureCount`

Status:

- Erfolgreiche Refreshes setzen den Status wieder auf `ok`, loeschen den Fehler und setzen den Failure-Count auf `0`.
- Fehlgeschlagene Refreshes setzen `refreshStatus="degraded"`, schreiben einen sanitisierten Fehler und erhoehen den Failure-Count.
- Prediction-State-, Feed- und Running-DTOs geben die Felder aus.
- Die Predictions-UI zeigt degraded Refreshes in Feed und Running-Schedules sichtbar an.
- Degraded Feed-Items koennen nicht wie gesunde Predictions an den Trading Desk gesendet werden.

Warum das wichtig ist:

- Nutzer sehen nicht mehr still alte oder nicht aktualisierte Predictions als gesund laufend.

### Prediction-Persistenz fail-closed

Status:

- `generateAndPersistPrediction` wirft bei `db.prediction.create` Fehlern `503 prediction_persist_failed`.
- Der manuelle Generate-Flow bricht danach ab.
- Auf Basis eines nicht persistierten History-Datensatzes werden keine Events, Notifications oder State-Updates mehr erzeugt.

Warum das wichtig ist:

- Tradable Predictions bleiben auswertbar und auditierbar; es gibt keinen erfolgreichen Generate-Flow ohne History-Datensatz.

### AI Provider Outbound Hardening

Status:

- AI-Base-URLs werden mit dem vorhandenen Safe-Outbound-URL-Helper validiert.
- Production blockt unsichere `http` OpenAI-kompatible URLs, URL-Credentials, private/loopback/link-local/metadata Ziele und unsichere Redirects.
- Fetches nutzen `redirect: "error"`.
- Private Ollama-Base-URLs sind in Production nur mit explizitem `AI_ALLOW_PRIVATE_OLLAMA_BASE_URL=1` beziehungsweise bewusst gesetzter Option erlaubt.
- Unsafe URLs loggen intern `unsafe_ai_base_url`, liefern nach aussen aber generisch AI-unavailable/503.

Warum das wichtig ist:

- AI-Konfiguration kann nicht mehr unbemerkt als SSRF-Pfad auf interne Dienste oder Metadata-Endpunkte zeigen.

## Nach-Fix Review

Gezielter Re-Review der fuenf Findings:

- Fallback-Cache-Poisoning: behoben, keine normale Cache-Schreibung bei Fallbacks gefunden.
- Falscher Evaluator-Horizont: behoben, v2-Horizont wird in Candidate-Filter und Realized-Return genutzt.
- Unsichtbare Auto-Refresh-Fehler: behoben, State/API/UI tragen Refresh-Health.
- Soft-success bei Persistenzfehlern: behoben fuer den Generate-Flow; `persisted:false` bleibt nur fuer den bestehenden "existing state reused"-Pfad.
- Freie AI-Provider-Outbound-URLs: behoben, Safe-Outbound-Validierung und Redirect-Block sind aktiv.

Im gezielten Nach-Fix-Review wurden keine neuen code-level P1/P2-Go-live-Blocker in den betroffenen AI-Prediction-Pfaden gefunden. Rest-Risiko bleibt bei Deployment, echter Provider-Konfiguration und Scheduler-Smokes.

## Test- und Verification-Status

Erfolgreich ausgefuehrt:

- `npm run db:generate`
- `node ./node_modules/tsx/dist/cli.mjs --test apps/api/src/ai/analyzer.test.ts apps/api/src/ai/provider.config.test.ts apps/api/src/jobs/predictionEvaluatorJob.test.ts apps/api/src/predictions/refreshHealth.test.ts apps/api/src/predictions/routes-generate.test.ts`
- `npm -w apps/api run test:ai` mit 108 bestandenen Tests.
- `npm -w apps/api run test:predictions-evaluator` mit 7 bestandenen Tests.
- `npm -w apps/api run test:predictions-refresh` mit 22 bestandenen Tests.
- `node ./node_modules/tsx/dist/cli.mjs --test apps/api/src/predictions/routes-generate.test.ts` mit 2 bestandenen Tests.
- `npm -w apps/web run i18n:check`
- `npm -w apps/api run typecheck -- --pretty false`
- `PATH=/Users/marioeuchner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm -w apps/web run typecheck -- --pretty false`
- `git diff --check`

Hinweise:

- Lokale Default-Node-Version ist `18.20.8`; Web-Typecheck wurde deshalb mit der gebuendelten Codex-Runtime Node `24.14.0` ausgefuehrt, weil Next >= 20.9 erwartet.
- Einige AI-Tests loggen Prisma-Warnungen, weil lokal kein Datenbankserver auf `localhost:5433` erreichbar ist. Die Tests fallen dabei wie vorgesehen auf Defaults zurueck und bestehen.
- Echte Provider-, Scheduler- und Auto-Trading-Smokes wurden noch nicht ausgefuehrt, weil dafuer Production-nahe Secrets, Provider-Quotas und bewusst gewaehlte Accounts noetig sind.

## Vor Canary pruefen

- Migration:
  - Prisma-Migration `20260502133000_prediction_refresh_health` in Staging/Production anwenden.
  - Nach Migration pruefen, dass bestehende `PredictionState` Rows `refresh_status='ok'` und `refresh_failure_count=0` haben.
- Provider-Konfiguration:
  - OpenAI-kompatible Base-URL muss `https` sein.
  - Keine privaten, lokalen oder Metadata-Ziele fuer Production.
  - Private Ollama nur bewusst mit `AI_ALLOW_PRIVATE_OLLAMA_BASE_URL=1`.
  - Unsichere Base-URL muss `503` liefern und intern `unsafe_ai_base_url` loggen.
- AI-only-Smoke:
  - Provider erreichbar: AI-only Generate funktioniert und persistiert History.
  - Provider nicht erreichbar: AI-only Generate faellt geschlossen, kein lokaler Fallback als AI-Signal.
- Refresh-Smoke:
  - Laufender Schedule aktualisiert `refreshStatus="ok"`.
  - Simulierter Provider-/Venue-Fehler setzt `refreshStatus="degraded"` und erhoeht den Failure-Count.
  - Naechster erfolgreicher Refresh setzt Status wieder auf `ok`.
- Evaluator-Smoke:
  - Neue Prediction wird erst nach vollem `horizonMs` bewertet.
  - Alte `close_to_close_v1` Rows werden mit `close_to_close_v2` neu bewertet.
  - `outcomeMeta.realizedHorizonMs` ist sichtbar.
- UI-Smoke:
  - Feed zeigt degraded Refresh sichtbar.
  - Running-Schedules zeigen Refresh-Fehler sichtbar.
  - Degraded Predictions koennen nicht an den Trading Desk gesendet werden.

## Noch offen vor breitem Go-live

- Monitoring und Alerts:
  - `refreshStatus="degraded"` pro Workspace/Symbol/Timeframe.
  - `refreshFailureCount` ueber Schwellwert.
  - `prediction_persist_failed`.
  - `unsafe_ai_base_url`.
  - AI-Rate-Limits und Provider-Fehlerquote.
  - Evaluator-Lag: faellige, aber noch nicht bewertete Predictions.
- Operator-Runbook:
  - Was tun bei dauerhaft degraded Schedules?
  - Wie Provider-Konfiguration sicher wechseln?
  - Wie alte v1-Metriken einmalig neu berechnen und pruefen?
  - Wann Schedules pausieren statt weiter retryen?
- Production-Konfiguration:
  - Node-Version fuer Web-Build/Typecheck auf >= 20.9 fixieren.
  - Provider-Secrets und Base-URLs getrennt fuer Staging/Production pruefen.
  - Migration in Deploy-Checklist aufnehmen.
  - Log-Scrubbing fuer AI-Fehler weiter beobachten.
- Daten-/Metrik-Validierung:
  - Nach v2-Recompute stichprobenartig realized Returns gegen Candle-Daten pruefen.
  - Calibration/Hit-Rate vor und nach v2 vergleichen.
  - Keine Auto-Trading-Entscheidung auf Rows ohne persistierte Prediction-History stuetzen.

## Spaeter sinnvolle Verbesserungen

- Admin-Dashboard fuer AI-Health:
  - degraded Schedules.
  - letzter erfolgreicher Refresh.
  - letzter Provider-Fehler.
  - Failure-Count und naechster Retry.
- Provider-Allowlist zentral konfigurierbar machen:
  - erlaubte Hostnames.
  - explizite Ollama/Internal-Provider-Profile.
  - Preview-Test der Base-URL vor Speichern.
- Erweiterte Reconciliation:
  - Job fuer regelmaessige v1-zu-v2-Metrik-Recomputes.
  - Backfill-Status pro Workspace/Symbol/Timeframe.
- Mehr UI-Kontext:
  - Degraded-Detail-Popover mit Fehlerzeitpunkt, letztem Versuch und naechstem Refresh.
  - Filter fuer degraded/stale Predictions.
  - Hinweis, wenn eine Prediction wegen AI-only Fail-Closed nicht erzeugt wurde.
- Bessere Provider-Resilienz:
  - Provider-Fallback-Ketten mit klarer Kennzeichnung.
  - Circuit Breaker pro Provider/Workspace.
  - getrennte Rate-Limits fuer Generate, Refresh und Market-Analysis.
- Evaluation-Ausbau:
  - separate Metriken fuer 1h/4h/1d Horizons.
  - Drift- und Calibration-Alerts.
  - Modell-/Prompt-Vergleich ueber stabile Evaluation-Snapshots.

## Go-live Empfehlung

AI Predictions haben die bekannten Code-Go-live-Blocker aus dem Review geschlossen. Fuer einen kontrollierten internen Canary ist der Stand nach Migration, Provider-Konfig-Smoke und Scheduler-Smoke vertretbar.

Nicht als breiten Go-live freigeben, solange diese Punkte nicht gruen sind:

- Prisma-Migration in Staging/Production angewendet.
- Provider-Smoke fuer sichere HTTPS-Base-URL bestanden.
- AI-only Fail-Closed-Smoke bestanden.
- Refresh-Degraded-Smoke in API und UI bestanden.
- v2-Evaluator-Stichprobe gegen echte Candle-Daten plausibel.
- Monitoring fuer degraded Refresh, Persistenzfehler, unsafe AI URLs und Evaluator-Lag aktiv.
- Operator-Runbook fuer degraded Schedules und Provider-Ausfaelle vorhanden.
