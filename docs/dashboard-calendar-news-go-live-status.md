# Go-live Status: Dashboard, Calendar und News

Stand: 2026-05-02

## Kurzstatus

Der Teilbereich ist fuer den Go-live deutlich gehaertet. Die sechs Review-Findings sind umgesetzt und durch fokussierte API-/UI-nahe Checks validiert:

- Dashboard-Routen sind serverseitig per RBAC gemappt.
- Dashboard Open Positions fallen bei komplett unsicheren Venue-Reads mit `503 dashboard_positions_degraded` fail-closed.
- Partielle Open-Positions-Fehler werden als `meta.degraded=true` sichtbar.
- News-Risk liefert bei fehlendem/defektem Calendar-Provider degraded-Metadaten und blockiert bei aktivem `newsRiskMode=block` plus globalem Enforcement fail-closed.
- Economic-Calendar-Queries sind auf 31 Tage und maximal 1000 Events begrenzt.
- FMP-News-URLs werden vor Persistenz/Response auf sichere `http`/`https`-URLs ohne Credentials reduziert.
- Calendar-Preference-Speicherfehler werden in der UI sichtbar.

## Behobene Go-live-Blocker

| Bereich | Status | Umsetzung |
| --- | --- | --- |
| Dashboard RBAC | Erledigt | `/dashboard/layout`, `/dashboard/overview`, `/dashboard/performance`, `/dashboard/risk-analysis`, `/dashboard/alerts` und `/dashboard/open-positions` sind im Permission-Mapping enthalten. |
| Open-Positions Exposure Safety | Erledigt | Komplett fehlgeschlagene relevante Venue-Reads liefern `503`; partielle Fehler bleiben `200`, aber mit `meta.degraded`, `partialErrors` und `failedExchangeAccountIds`. |
| Dashboard UI bei Degraded Reads | Erledigt | Die UI behaelt letzte bekannte Positionsdaten, zeigt degraded/partial Warnungen und zeigt bei unsicherem Read nicht mehr faelschlich "keine offenen Positionen". |
| News-Risk Fail-Closed | Erledigt | `evaluateNewsRiskForSymbol` und `/economic-calendar/next` geben degraded Status aus; Prediction-Policy behandelt degraded Calendar-State als Blockgrund, wenn News-Risk-Blocking aktiv ist. |
| Calendar Query Limits | Erledigt | `from > to`, invalides Datum und Range > 31 Tage werden mit `400` abgelehnt; `limit` Default `500`, Max `1000`, Response enthaelt `meta.truncated`. |
| News URL Sanitizing | Erledigt | Unsichere Article-URLs verwerfen den Row; unsichere Image-URLs werden `null`; URL-Credentials werden abgelehnt. |
| Calendar Preferences UI | Erledigt | Fehler beim `PUT /economic-calendar/preferences` erzeugen eine sichtbare Soft-Warning und werden nach erfolgreichem Save geloescht. |

## Teststatus

Ausgefuehrt:

- `node node_modules/tsx/dist/cli.mjs --test apps/api/src/auth/permissions.test.ts apps/api/src/dashboard/routes.test.ts apps/api/src/routes/economic-calendar.test.ts apps/api/src/services/economicCalendar/index.test.ts apps/api/src/services/news/index.test.ts apps/api/src/predictions/routes-generate.test.ts`  
  Ergebnis: 34/34 Tests bestanden.
- `npm -w apps/api run typecheck -- --pretty false`  
  Ergebnis: bestanden.
- `npm -w apps/web run i18n:check`  
  Ergebnis: bestanden.
- `PATH="/Users/marioeuchner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm -w apps/web run typecheck -- --pretty false`  
  Ergebnis: bestanden.
- `git diff --check`  
  Ergebnis: bestanden.

Hinweis: Der normale Web-Typecheck mit lokalem Node 18.20.8 scheitert erwartungsgemaess vor dem Codecheck, weil Next.js `>=20.9.0` verlangt. Mit der gebuendelten Node-Runtime laeuft er erfolgreich.

## Nach-Fix Review

Die urspruenglichen sechs Findings wurden erneut gegen die finale Diff geprueft:

- Finding 1: Dashboard-Routen fallen nicht mehr aus dem RBAC.
- Finding 2: Open-Positions-Widget kann bei komplettem Venue-Ausfall keine leere Live-Exposure-Liste mehr als gesund anzeigen.
- Finding 3: News-Risk faellt bei fehlendem Key oder Calendar-Read-Problem nicht mehr still offen, wenn Blocking aktiv ist.
- Finding 4: Calendar-Queries sind nicht mehr unbounded.
- Finding 5: Unsichere FMP-News-URLs werden vor dem Web-Rendering entfernt.
- Finding 6: Calendar-Preference-Save-Fehler werden nicht mehr still ignoriert.

## Noch offen vor Go-live

- Infra-Smoke auf Staging/VPS: Dashboard laden, Open-Positions bei gesunden und absichtlich blockierten Venue-Credentials pruefen.
- RBAC-Smoke mit Rollen: Nutzer ohne Trading/Bot/Exchange-Permission darf Dashboard-Daten nicht lesen; Nutzer mit passender Permission darf.
- News-Risk-Smoke: `enforceNewsRiskBlock=true`, Strategie `newsRiskMode=block`, FMP-Key temporaer entfernen und bestaetigen, dass Auto-/tradable Predictions blockieren.
- Calendar-Smoke mit realem FMP-Key: 31-Tage-Grenze, `limit`, `truncated` und `/economic-calendar/next` pruefen.
- Monitoring/Alerting fuer `dashboard_positions_degraded`, `calendar_read_failed`, `fmp_api_key_missing` und News-Provider-Partial-Failures anbinden.

## Spaeter sinnvoll

- Dashboard-Open-Positions Snapshot-Cache persistieren, damit nach einem API-Restart nicht nur In-Memory-UI-Daten als letzte bekannte Ansicht dienen.
- Calendar-Pagination statt nur `limit/truncated`, falls spaeter laengere Research-Zeitraeume im UI gebraucht werden.
- News-Provider-Sanitizing als gemeinsamen Helper fuer alle kuenftigen Provider extrahieren.
- User-freundliche Mapping-Texte fuer degraded Reasons im Calendar-UI statt technischer Reason-Codes.
- Separate Permission `dashboard.view`, falls Rollenmodell spaeter feiner zwischen Bot-, Exchange- und Dashboard-Leserechten trennen soll.
