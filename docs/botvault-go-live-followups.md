# BotVault Go-live Follow-ups

Stand: 2026-05-23

Dieses Dokument haelt Punkte fest, die nach den aktuellen BotVault-, HyperCore-/HyperEVM- und Profitshare-Fixes nicht als harte Code-Blocker fuer einen kontrollierten Canary gelten, aber vor einem breiteren Go-live oder kurz danach abgearbeitet werden sollten.

## Aktueller Status

Die zuletzt geprueften kritischen Geldfluss-Pfade sind stabilisiert:

- Pending Deposit/Withdraw wird nicht mehr als final abgeschlossen behandelt.
- Spot-to-EVM Transfers im Claim-Flow werden persistent als Pending-State gespeichert und koennen idempotent reconciled werden.
- Teilweise Spot-to-EVM Transfers werden nicht mehr faelschlich als `transfer_confirmed` gemeldet.
- v4 Profit-Claims werden auf finalized `BotVaultPnlAggregate.netWithdrawableProfit` begrenzt.
- v4 Profit-Claims/Close/Recover werden nur mit frischer Trading-Reconciliation weitergefuehrt.
- GridBot-Start wird fuer v4 erst freigegeben, wenn Funding, HYPE Reserve, Transfer-Observation und finale Perp-State-Reads verifiziert sind.
- GridBot-Funding-Wartepfade werden als `funding_pending` sichtbar und zaehlen nicht mehr als order-aktives `running`.
- API/UI Action Flags blockieren Claim, Close und Recover bei pending Funding oder Withdraw Reconciliation.
- Granulare Safety-Controls koennen Deposits, Withdraws, Grid-Starts und Profit-Claims getrennt sperren.
- Money-Flow-Pending-Zustaende erzeugen deduplizierte PlatformAlerts nach definierter Schwelle und werden in Admin Vault-Ops inklusive `reasonCode`, `recoveryHint`, `txHash`, `idempotencyKey` und erwarteter/tatsaechlicher Balance angezeigt.

Empfehlung: kontrollierter Production-Canary mit kleinen Limits ist vertretbar. Breiter Go-live erst nach echten Lifecycle-Durchlaeufen und Monitoring-Verifikation.

## Aktuelle Live-Follow-ups 2026-05-23

Aus den Production-Starts am 2026-05-23 sind keine harten BotVault-v4-Blocker
offen geblieben. Der Start laeuft automatisiert bis `running`, ist fuer User
aber noch zu langsam und in der UI nicht transparent genug.

Prioritaet fuer den naechsten Optimierungsdurchlauf:

- UI-Statuslatenz nach BotVault-Erstellung reduzieren. Der Backend-Status kann
  bereits `running` sein, waehrend der neue BotVault in der Webapp noch nicht
  schnell genug sichtbar oder aktualisiert ist.
- Frontend-Refetch/Cache-Invalidation nach Create/Start pruefen. Die konkrete
  BotVault-/Grid-Instanz sollte sofort nach der Startantwort nachgeladen oder
  optimistisch in die Liste eingetragen werden.
- BotVault-Statuspolling auf die konkrete neue Instanz ausrichten, solange der
  Start pending ist. Die UI sollte nicht nur auf breite Dashboard-Refreshes
  warten.
- Backend-Startzeit weiter optimieren. Der beobachtete zweite Start brauchte
  rund 3m20s von Create bis final `running`; stabil, aber fuer User lang.
- HyperCore/Funding-Sichtbarkeit und finale Readiness-Propagation beschleunigen,
  damit Grid `execution_active` sofort nach belastbarer `execution_ready`
  Evidenz gesetzt wird.
- HyperEVM `eth_getLogs` Recovery-Reads chunked ausfuehren. Live wurde ein
  retrybarer RPC-Fehler `query exceeds max block range 1000` beobachtet.
- Startup-Timeline als API/Admin-Diagnose aufbauen:
  Create, Funding, HyperCore funded, Margin verified, HYPE reserve ready,
  Execution ready, Grid running.
- Alte pre-v4 BotVaults konsequent aus aktiver Reconciliation und UI-/Admin-
  Sichtbarkeit entfernen, sofern sie nicht mehr produktiv genutzt werden.
- AI/Salad weiter separat behandeln. AI/Prediction-Probleme duerfen BotVault-
  Start und BotVault-UI-Status nicht blockieren.

Umgesetzt im Optimierungsdurchlauf am 2026-05-23:

- Scheduled Funding-Tx-Recovery auf einen kurzen 1000-Block-Lookback begrenzt.
- Historische Funding-Tx-Recovery fuer manuelle/deepere Laeufe in 1000-Block-
  Chunks aufgeteilt.
- Create-Seite pollt den konkreten neuen GridBot waehrend Provisioning alle 2s.
- Create-Seite redirectet sofort, sobald die konkrete Instanz `running` oder
  `execution_active` ist.
- GridBot-Uebersicht fetched den per URL fokussierten `instanceId` direkt.
- GridBot-Uebersicht zeigt die Liste sofort und laedt Fill-/Round-Statistiken
  danach im Hintergrund.
- GridBot-Uebersicht aktualisiert bei fokussiertem `instanceId` alle 2.5s statt
  alle 10s.
- Sortierung nutzt `updatedAt`/`createdAt` als Fallback, damit neue Bots ohne
  `lastPlanAt` nicht unten einsortiert werden.

Noch per Live-Start zu verifizieren:

- Der neue Bot erscheint in der UI innerhalb weniger Sekunden nach Backend-
  `running`.
- Der `query exceeds max block range 1000` Warning verschwindet aus dem
  Scheduled-Recovery-Pfad.
- Die externe HyperCore-Sichtbarkeit bleibt der groesste nicht voll lokal
  kontrollierbare Zeitanteil.

## Verifikation 2026-05-06

- `npm -w packages/futures-exchange run test:vault-grid-corewriter`: PASS, 64/64.
- `npm -w apps/runner run test:vault-grid-corewriter`: PASS, 127/127.
- `npm -w apps/api run test:botvault-v4-transitions`: PASS, 15/15.
- `npm -w apps/api run test:vault-grid-corewriter`: PASS, 9/9.
- Vault-Suite mit Node >=20 und `--test-force-exit`: PASS, 214/214.
- `npm -w apps/api run typecheck`: PASS.
- `npm -w apps/runner run typecheck`: PASS.
- `npm -w apps/web run typecheck`: PASS mit Node >=20.9.0.
- `git diff --check`: PASS.

Hinweis: Die lokale Standard-Node-Version war `v18.20.8`; die Node-20+-Checks wurden mit der gebuendelten Codex-Node-Runtime `v24.14.0` ausgefuehrt.

## Vor Canary pruefen

- Live-Canary mit kleinem Betrag durchfuehren:
  - EVM Funding zum Vault.
  - Deposit nach HyperCore.
  - Pending Deposit Reconcile.
  - GridBot Start erst nach `funding_confirmed`.
  - Profit Claim blockiert waehrend Spot-to-EVM Pending.
  - Claim erfolgreich nach EVM Balance Reconcile.
  - Close oder Recover mit Spot-to-EVM Pending und finalem Reconcile.
- Runtime-Konfiguration pruefen:
  - Reconcile Scheduler aktiv.
  - Runner nutzt aktuelle API/DB Version.
  - HyperEVM RPC Write/Read URLs korrekt.
  - CoreWriter Private-Key/Agent-Wallet Secrets korrekt geladen.
  - HYPE Reserve Thresholds fuer v4 sinnvoll gesetzt.
- Canary Limits setzen:
  - Maximaler Deposit pro BotVault.
  - Maximaler Claim/Close Betrag.
  - Nur ausgewaehlte User/Admin Accounts.
  - Feature Flag oder manuelle Freigabe fuer v4 BotVault Runtime.

## Nicht vergessen vor breiterem Go-live

- Monitoring und Alerts:
  - `deposit_pending_reconciliation` laenger als definierte Schwelle: umgesetzt als `botvault_deposit_pending_reconciliation`.
  - `withdraw_pending_reconciliation` laenger als definierte Schwelle: umgesetzt als `botvault_withdraw_pending_reconciliation`.
  - `insufficient_contract_balance`: umgesetzt als `botvault_contract_balance_mismatch`.
  - Reconcile-Job Fehler/degraded: umgesetzt als `botvault_reconcile_job_degraded`.
  - Noch offen fuer breiteren Public-Go-live: harte Alert-Matrix fuer `funding_failed_retryable`, `funding_failed_final`, `bot_vault_v4_funding_verification_missing` und Low-HYPE feiner in PlatformAlerts statt nur Logs/Status spiegeln.
- Admin-Operational-View:
  - Pending Deposit vs Pending Withdraw getrennt anzeigen: erledigt in `/admin/vault-ops/reconciliation-summary`.
  - `reasonCode`, `recoveryHint`, `txHash`, `idempotencyKey` sichtbar machen: erledigt fuer Money-Flow-Pending.
  - Manuelle Aktion klar trennen von automatisch retrybarem Zustand: noch in Canary gegen echte Alerts/Recovery-Flows pruefen.
- Bestehende Vaults normalisieren:
  - Alte `initialCoreSpotTransferDoneAt` Zustaende gegen echte Funding-Metadaten pruefen.
  - Alte `bot_vault_v3` Runtime-Metadaten kompatibel halten, aber neue Writes auf `bot_vault_v4` normalisieren.
  - Vaults mit alten Pending-/Done-Mischzustaenden einmal per Reconcile-Job oder Migration nachziehen.
- Runbook ergaenzen:
  - Was tun bei Pending Deposit Timeout?
  - Was tun bei Pending Withdraw Timeout?
  - Was tun bei HYPE Reserve nicht verfuegbar?
  - Was tun bei Claim blockiert wegen Contract Balance?
  - Wann manuell eingreifen, wann nur Reconcile abwarten?

## Nach Canary nachziehen

- Echte Transaktionsdaten aus Canary auswerten:
  - Dauer von EVM-to-Core Deposit bis final confirmed.
  - Dauer von Core Spot-to-EVM Withdraw bis Vault Contract Balance sichtbar.
  - Haefigkeit von RPC/Receipt Timeouts.
  - Haefigkeit von transienten Hyperliquid API Fehlern.
- Reconcile-Intervalle anhand der Live-Daten feinjustieren.
- Alert-Schwellen anhand echter Laufzeiten setzen statt nur konservativer Defaults.
- Smoke-Test erweitern um echte Sandbox/Testnet-artige Umgebung, falls verfuegbar.
- Dokumentation fuer Support/Admin aktualisieren:
  - Funding-Status Matrix.
  - Claim-/Close-/Recover-Status Matrix.
  - Profitshare/HWM Kurzbeschreibung.

## Produktreife Verbesserungen ohne harte Go-live-Blocker

- Full-Suite Test-Failures, die nicht BotVault-spezifisch sind, separat einordnen und bereinigen oder dokumentiert ausschliessen.
- Dashboard fuer BotVault Lifecycle Events bauen:
  - Funding requested.
  - Deposit submitted.
  - Deposit confirmed.
  - Perp margin transferred.
  - HYPE reserve ready.
  - Execution ready.
  - Withdraw pending.
  - Claim settled.
- Bessere Reconcile-Historie speichern:
  - letzter Check.
  - letzter Fehler.
  - Anzahl Retry-Versuche.
  - naechster geplanter Retry.
- Idempotency-Key Suche in Admin-Tools ergaenzen, damit doppelte oder haengende Transfers schneller analysiert werden koennen.
- Runtime-Naming-Cleanup: `botVaultRuntime.service.ts` ist weiterhin Legacy-kompatibler Reexport; neue Log-/Metadata-Standards sollten weiter auf `runtimeModel` normalisiert werden.
- Profitshare Reporting ausbauen:
  - finalized realized PnL.
  - net withdrawable profit.
  - HWM before/after.
  - Fee base.
  - Treasury und Affiliate Split.
- Legacy Naming weiter aufraeumen:
  - Neue Runtime-Metadaten nur noch `bot_vault_v4`.
  - Alte `bot_vault_v3` Reads kompatibel halten.
  - Monitoring und Logs auf Runtime-Model statt Contract-Spitznamen ausrichten.

## Entscheidung fuer den naechsten Schritt

Vor dem naechsten Feature sollte mindestens klar sein:

- Canary-Betrag und User-Kreis sind definiert.
- Monitoring/Alerts fuer Pending und Failed States sind eingerichtet.
- Ein Admin kann Pending States lesen und die naechste Recovery-Aktion erkennen.
- Bestehende Vaults wurden einmal gegen die neuen Reconcile-Regeln geprueft.

Wenn diese Punkte gruen sind, kann das naechste Feature begonnen werden, ohne die BotVault-Go-live-Risiken aus den Augen zu verlieren.
