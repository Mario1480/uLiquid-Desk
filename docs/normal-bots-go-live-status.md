# Normal Bots Go-Live Status

Stand: 2026-05-02

## Aktueller Status

Normale Trading Bots sind vorerst als Offchain-Trading-Bots behandelt. BotVault ist fuer normale Bots deaktiviert und bleibt bis zur separaten Freigabe nur fuer GridBots aktiv.

API und Runner blockieren normale Bots ohne explizit konfigurierten Signal-Plugin-Pfad konservativ mit `strategy_runtime_not_available`. Live-Execution darf nicht mehr ueber den alten Noop-Adapter laufen. Neue normale Live-Orders bekommen einen deterministischen `clientOrderId` und werden vor dem Submit als Pending-State gespeichert.

## Behobene Go-Live-Blocker

- BotVault wird bei normalen Bots nicht mehr automatisch erstellt.
- BotVault-Readiness blockiert normale Bots beim Start nicht mehr.
- BotVault-Action-Endpunkte liefern fuer normale Bots `bot_vault_not_enabled_for_strategy`.
- Normale Bots ohne echten Signal-Runtime-Pfad laufen nicht mehr still ueber `DummyStrategy`.
- Simple-Execution nutzt im Live-Betrieb einen echten Runner-Futures-Adapter oder blockiert mit `execution_adapter_unavailable`.
- Order-Submits speichern Pending-State mit deterministischem `clientOrderId`.
- Ein unresolved Pending Order blockiert den naechsten Tick und wird zuerst reconciled.
- Accepted/submitted Orders aktualisieren Runtime-State erst nach Position/FIll-Reconcile.

## Offene Nicht-Blocker / Canary-Punkte

- Einen produktiven Signal-Adapter fuer normale Strategien fertig anbinden und pro Strategie explizit freischalten.
- Fill-Reconciliation fuer normale Bots um echte Venue-Fill-Historie erweitern; aktuell ist Position-State die konservative Quelle.
- Paper-Execution fuer normale Bots kann spaeter einen vollwertigen Paper-Futures-Adapter bekommen.
- UI sollte `strategy_runtime_not_available`, `pending_order_reconciliation` und `pending_fill_confirmation` mit klarer Recovery-Hilfe anzeigen.
- BotVault-Rollout fuer normale Bots erst nach stabilem GridBot-BotVault-Canary erneut planen.

## Canary-Checkliste

- Normalen Bot ohne BotVault erstellen.
- Start ohne BotVault-Readiness-Gate pruefen.
- Bot ohne echten Signal-Plugin-Pfad blockiert mit `strategy_runtime_not_available`.
- Bot mit echtem Signalpfad erzeugt Open-Intent.
- Live-Adapter ist vorhanden; sonst blockiert `execution_adapter_unavailable`.
- Submit persistiert Pending-State mit `clientOrderId`.
- Restart/Tick mit unresolved Pending Order sendet keine zweite Order.
- Position/FIll-Reconcile bestaetigt Entry und aktualisiert Runtime-State.
- Close-Intent wird erst nach Flat-Reconcile finalisiert.

## Referenzen

- BotVault/GridBot Follow-ups: `docs/botvault-go-live-followups.md`
- GridBot Status: `docs/gridbot-go-live-status.md`
