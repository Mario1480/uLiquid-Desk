# Trading Desk Go-live Status

Stand: 2026-05-02

Diese Doku haelt den aktuellen Go-live-Status des manuellen Trading Desks fest. Sie ergaenzt `docs/manual-trading-desk.md`, `docs/gridbot-go-live-status.md` und `docs/botvault-go-live-followups.md`.

## Aktueller Status

Der Trading Desk ist nach den letzten Hardening-Fixes deutlich naeher an einem kontrollierten Production-Canary. Die wichtigsten Risiken aus dem Review sind im Code adressiert:

- Live-Mutationen fuer Order Submit, Position Close und Cancel-All sind jetzt verpflichtend idempotent.
- Der Web-Client sendet pro riskanter Aktion einen neuen `idempotencyKey`.
- Buttons fuer Submit, Close, Cancel-All und Einzel-Cancel werden bei laufender Aktion oder unsicheren Live-Daten blockiert.
- Position-Close setzt Bot-State und offene History nur noch auf closed, wenn ein Post-Close-Read wirklich keine Restposition mehr sieht.
- Degradierte Positions- und Open-Order-Reads liefern fail-closed `503 market_data_degraded` statt `200 items: []`.
- Die Trading-Desk-UI behaelt bei Market-Data-Fehlern die letzten bekannten Daten, zeigt eine Warnung und sperrt Trading-Aktionen.
- RBAC-Mapping fuer Trading-Desk-Reads und Settings ist vereinheitlicht.
- Settings-Save-Fehler werden nicht mehr still verschluckt, sondern als Soft-Warning sichtbar.

Empfehlung: Ein kleiner Paper- und danach Live-Canary mit engem Limit ist nach erfolgreichem Smoke vertretbar. Ein breiter Go-live sollte erst nach echten Venue-Smokes, Monitoring und Operator-Runbook erfolgen.

## Behobene Go-live Blocker

### Idempotency fuer Live-Aktionen

Betroffene Routen:

- `POST /api/orders`
- `POST /api/positions/close`
- `POST /api/orders/cancel-all`

Status:

- Fehlender Key liefert `400 { error: "idempotency_key_required" }`.
- Gleicher Key waehrend laufender Aktion liefert `409 { error: "idempotency_in_progress" }`.
- Erfolgreiche Antworten werden fuer Replay durch die vorhandene Idempotency-Middleware wiederverwendet.
- Keys werden user-scoped gespeichert, damit gleiche Client-Keys verschiedener Nutzer nicht kollidieren.

### Close-State-Sync

Status:

- `BotTradeState` und offene `BotTradeHistory` werden nur geschlossen, wenn der frische Live-Read keine Restposition fuer Symbol/Side findet.
- Wenn die Close-Order angenommen wurde, aber noch Live-Exposure sichtbar ist, bleibt die interne Historie offen.
- Die Close-Response meldet `stateSync.status`:
  - `synced`
  - `pending_live_position`
  - `sync_skipped_read_failed`

Warum das wichtig ist:

- Browser-Retries, Venue-Latenz oder partial/pending Reduce-Only Orders koennen nicht mehr dazu fuehren, dass der Bot intern flat wirkt, obwohl noch Exposure existiert.

### Degraded Market Data

Status:

- `/api/positions` liefert bei transientem Hyperliquid-Fallback `503 market_data_degraded`.
- `/api/orders/open` liefert bei transientem Hyperliquid-Fallback `503 market_data_degraded`.
- Die UI interpretiert diese Fehler nicht mehr als leere Positionen oder leere Open Orders.
- Account-Summary mit `degraded: true` blockiert Trading ebenfalls.

Warum das wichtig ist:

- Der Desk zeigt keine falsche Flat-Situation mehr, wenn die Venue gerade nicht verlaesslich gelesen werden kann.

### RBAC und Settings

Status:

- `/api/account/summary`, `/api/positions`, `/api/orders/open` und `/api/market/candles` erfordern manuelle Trading-Permissions.
- `/api/symbols` erlaubt zusaetzlich `bots.view`, weil der Endpunkt auch von Bot-/Prediction-Flows genutzt wird.
- `/api/trading/settings` GET/POST erlaubt `bots.view`, `trading.manual_market` oder `trading.manual_limit`.
- `trading.price_support` wird fuer normale Trading-Desk-Settings nicht mehr verlangt.

### UI-Sicherheit

Status:

- Submit/Close/Cancel-All/Cancel werden bei degraded Live-Daten deaktiviert.
- Close und Cancel-All haben eine Browser-Bestaetigung mit Account, Symbol und Scope.
- Close und Cancel-All haben In-Flight-State und koennen nicht doppelt geklickt werden.
- Settings-Speicherfehler werden als Warning angezeigt.

## Test- und Verification-Status

Erfolgreich ausgefuehrt:

- `npm -w apps/api run test:auth`
- `npm -w apps/web run i18n:check`
- `npm -w apps/api run typecheck -- --pretty false`
- `PATH=/Users/marioeuchner/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm -w apps/web run typecheck -- --pretty false`
- `git diff --check`

Hinweis:

- Der Root-Befehl `npm run typecheck -- --pretty false` bricht mit der lokal aktiven Node-Version `18.20.8` im Web-Workspace ab, weil Next 16 mindestens Node `20.9.0` verlangt.
- Mit der gebuendelten Codex-Runtime Node `24.14.0` ist der Web-Typecheck erfolgreich.
- Echte Paper-/Live-Smokes wurden noch nicht ausgefuehrt, weil dabei Orders gegen Execution-Accounts ausgeloest werden koennen.

## Vor Canary pruefen

- Paper-Smoke:
  - Market Order submit.
  - Limit Order submit.
  - Einzelne Order canceln.
  - Cancel-All.
  - Position close.
  - Refresh nach jeder Aktion.
  - Settings speichern und Reload pruefen.
- Live-Canary mit kleinem Betrag:
  - Ein Account, ein Symbol, kleine Notional-Grenze.
  - Submit, Cancel, Close und Refresh manuell pruefen.
  - Keine Parallel-Tabs fuer ersten Canary.
  - Nach jeder Aktion Venue UI gegen Desk UI abgleichen.
- RBAC-Smoke:
  - User ohne `trading.manual_market`/`trading.manual_limit` darf Accountdaten im Desk nicht lesen.
  - User mit manueller Trading-Permission darf Desk-Reads nutzen.
  - User mit nur `bots.view` darf Symbole und Settings fuer Bot-/Prediction-Flows weiter nutzen.
- Degraded-Smoke:
  - Hyperliquid transienten Read-Fehler simulieren oder kontrolliert provozieren.
  - `/api/positions` und `/api/orders/open` muessen `503 market_data_degraded` liefern.
  - UI muss letzte bekannte Daten halten und Trading-Aktionen sperren.
- Idempotency-Smoke:
  - Request ohne `idempotencyKey` gegen Mutationsroute muss `400` liefern.
  - Zwei gleiche Keys parallel muessen `409 idempotency_in_progress` fuer den zweiten Request liefern.
  - Browser-Doppelklick darf keine zweite Live-Order ausloesen.

## Noch offen vor breitem Go-live

- Monitoring und Alerts:
  - `market_data_degraded` Rate pro Venue/Account.
  - Close-Responses mit `pending_live_position`.
  - Close-Responses mit `sync_skipped_read_failed`.
  - Idempotency `409 idempotency_in_progress`.
  - Order Submit/Close/Cancel-All Fehlerquote.
- Operator-Runbook:
  - Was tun bei `pending_live_position`?
  - Was tun bei `sync_skipped_read_failed`?
  - Wie Venue-Position manuell gegen Bot-State abgleichen?
  - Wann Reconciliation abwarten, wann manuell eingreifen?
- Admin/Support-Sicht:
  - Letzte Trading-Desk-Aktion pro User/Account.
  - Letzter Idempotency-Key und Status.
  - Letzter Market-Data-Fehler pro Venue.
  - Bot-State/History Sync-Status fuer manuell geschlossene Positionen.
- Production-Konfiguration:
  - Node-Version fuer Web-Build/Typecheck auf >= 20.9 fixieren.
  - API/Web Deployment nach dem Trading-Desk-Patch smoke-testen.
  - Caddy/Reverse Proxy und direkte API-Erreichbarkeit erneut pruefen.

## Spaeter sinnvolle Verbesserungen

- Persistenter Pending-Close-Reconciliation-State statt nur offener History:
  - pending close action id.
  - close order ids.
  - letzter Venue-Read.
  - retry count.
  - naechster Reconcile-Zeitpunkt.
- UI-Drilldown fuer degraded Daten:
  - Welche Quelle ist degraded?
  - Seit wann?
  - Letzter erfolgreicher Read.
  - Retry-Status.
- Audit Trail fuer manuelle Trading-Aktionen:
  - userId.
  - exchangeAccountId.
  - symbol.
  - marketType.
  - payload summary.
  - idempotencyKey.
  - result status.
- Erweiterte Tests:
  - Route-Level Tests fuer `POST /api/orders`, `/api/positions/close`, `/api/orders/cancel-all`.
  - Simulierter Close mit Restposition und bestaetigtem Flat-Read.
  - UI-Test fuer blockierte Buttons bei `market_data_degraded`.
  - Network-Payload-Test fuer clientseitige Idempotency-Keys.
- Bessere UX fuer kritische Aktionen:
  - Eigener Confirm-Dialog statt Browser `confirm`.
  - Account/Symbol/Side/Notional kompakt sichtbar.
  - Expliziter "Ich verstehe"-Step fuer Live Close/Cancel-All.
- Venue-Parity weiter ausbauen:
  - Verhalten von Hyperliquid, Bitget, MEXC, Paper und Spot/Perp getrennt dokumentieren.
  - Per-Venue Capability Matrix fuer manuelle Aktionen.

## Go-live Empfehlung

Der Trading Desk hat die bekannten Code-Go-live-Blocker aus dem Review geschlossen. Fuer einen kontrollierten Canary ist der Stand nach Paper-Smoke und kleinem Live-Smoke grundsaetzlich vertretbar.

Nicht als Big-Bang-Go-live freigeben, solange diese Punkte nicht gruen sind:

- Paper-Smoke komplett bestanden.
- Kleiner Live-Canary gegen echte Venue bestanden.
- Monitoring fuer degraded Reads und Close-Sync-Status aktiv.
- Operator-Runbook fuer haengende Close-/Sync-Zustaende vorhanden.
- Production Node-Version fuer Web-Builds auf >= 20.9 gesichert.
