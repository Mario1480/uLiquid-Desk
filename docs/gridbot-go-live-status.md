# GridBot Go-live Status

Stand: 2026-05-02

Diese Doku ergaenzt `docs/botvault-go-live-followups.md` und haelt den aktuellen GridBot-Stand fuer Go-live, Canary und spaetere Nacharbeit fest.

## Aktueller Status

Der GridBot-Bereich ist nach den letzten Hardening-Patches deutlich stabiler fuer einen kontrollierten Canary. Funding, Seed-Order, Order-Recovery, Cancel-Pfad, Fill/PnL-Reconciliation und Live-Risk-Gates sind auf die wichtigsten Go-live-Risiken ausgerichtet.

Wichtig: Das ist keine Freigabe fuer einen unbegrenzten Big-Bang-Go-live. Empfohlen bleibt ein Canary mit kleinen Limits, aktivem Monitoring und klarer manueller Recovery.

## Behobene Go-live Blocker

- Initiales HyperEVM zu HyperCore Funding wird erst als bestaetigt gewertet, wenn der volle angeforderte Core-Spot-Betrag vorhanden ist.
- Core zu Perp Funding wird nicht erneut submitted, solange ein unresolved pending Transfer existiert. Pending Transfers werden zuerst ueber frischen Account-State reconciled.
- Initial Seed Orders nutzen deterministische Client-Order-IDs und speichern pending Confirmation fuer unknown/transport-unsichere Submit-Ergebnisse.
- Finale Seed-Submit-Fehler loeschen den Pending-State sauber und erhoehen den Attempt-State nur fuer einen abgeschlossenen finalen Fehler.
- Pending Place-Orders speichern Candidate-/Tx-Referenzen fuer Recovery.
- Client-only Cancels duerfen lokal nicht mehr als canceled enden, wenn keine cancelbare Venue-Referenz gefunden wurde.
- Runner Fill-Sync und finalized Trading-Reconciliation sind entkoppelt, damit Profitshare/HWM nicht auf null-PnL-Fills haengen bleibt.
- Planner Risk nutzt fuer BotVaults frische Live-Account-State-Daten konservativ.
- Reines Min-Investment-Gating entfernt keine Maintenance-Entries mehr bei laufenden Grids.

## Noch offene Nicht-Blocker

- Canary-Monitoring fuer Funding-Latenzen, pending Transfer Age, Seed-Pending-Age und Reconcile-Erfolgsrate sollte vor breiter Freigabe als Dashboard/Alert stehen.
- Manuelle Recovery-Runbooks fuer `grid_initial_perp_funding_pending`, `grid_initial_seed_confirmation_pending`, Cancel-Reconcile und PnL-Reconcile sollten noch operationalisiert werden.
- Langlauf-Test mit echten HyperCore/HyperEVM Latenzen sollte mindestens einmal ueber mehrere Marktzyklen laufen.
- UI kann fuer Admins noch bessere Drilldowns auf `reasonCode`, `recoveryHint`, txHash, candidateOrderId und Account-State-Zeitpunkt bekommen.
- Canary-Limits sollten technisch konfiguriert werden: maximale Vault-Groesse, maximale parallele Bots, maximale pending Dauer vor manueller Pruefung.

## Canary-Checkliste

1. Vault auf HyperEVM funded.
2. HyperEVM zu HyperCore Deposit absichtlich pending beobachten.
3. Reconcile bestaetigt erst bei vollem Core-Spot-Betrag.
4. Core zu Perp Funding pending erzeugen oder simulieren.
5. Runner-Tick loest keinen zweiten Core zu Perp Transfer aus.
6. Account-State bestaetigt Perp Funding und setzt Funding final.
7. Seed-Submit mit deterministischer Client-Order-ID pruefen.
8. Unknown Seed-Submit nach Restart reconciled gegen Venue Orders, Fills und Position.
9. Grid-Order-Recovery matched ueber clientOrderId, exchangeOrderId und candidateOrderId.
10. Cancel ohne Venue-Referenz blockiert und markiert nicht lokal canceled.
11. Fill-Sync schreibt GridBotFillEvent, Trading-Reconcile finalized realized PnL.
12. Profit-Claim bleibt blockiert, bis Aggregate frisch, flat und finalized ist.
13. Profit-Claim funktioniert nach finaler PnL- und Balance-Reconciliation.

## Test- und Review-Status

Gezielte Tests decken nun ab:

- Pending Perp-Funding blockiert erneute Submits.
- Account-State kann einen pending Perp-Transfer final bestaetigen.
- Final fehlgeschlagene Seed-Submits werden nicht weiter als pending behandelt.
- Min-Investment allein entfernt keine Maintenance-Entries bei laufenden Grids.
- Stale oder fehlender Live-State blockiert neue Entries weiterhin hart.

Vor Canary erneut ausfuehren:

- `npm run typecheck --workspace apps/runner`
- `npm run test:vault-grid-corewriter --workspace apps/runner`
- `PYTHONPATH=apps/py-strategy-service /tmp/uliquid-py-strategy-venv/bin/python -m pytest apps/py-strategy-service/tests/test_grid_planner.py`

## Go-live Empfehlung

Fuer einen kleinen Canary ist der GridBot nach erfolgreichem Testlauf grundsaetzlich bereit. Fuer einen breiten Go-live sollten die offenen Monitoring-, Runbook- und Langlaufpunkte vorher abgeschlossen oder bewusst als kontrolliertes Betriebsrisiko akzeptiert werden.
