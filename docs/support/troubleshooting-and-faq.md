---
description: Haeufige Fehlerbilder, Diagnose und Antworten auf Standardfragen.
icon: life-buoy
---

# Troubleshooting und FAQ

## Daten fehlen oder laden nicht

Pruefe:

- API Health.
- Internet- und Browser-Verbindung.
- Exchange-Account Status.
- Letzte Synchronisierung.
- Runner-Status.
- Websocket-Verbindung.
- Rollen und Workspace.

Wenn nur einzelne Bereiche betroffen sind, pruefe die jeweilige Feature-Seite und Alerts.

## Trading-Button ist deaktiviert

Moegliche Ursachen:

- fehlende Permission,
- Re-Auth erforderlich,
- degradiertes Live-Data-Signal,
- keine Exchange-Account-Auswahl,
- Symbol fehlt,
- laufende Aktion,
- Wartungsmodus,
- Feature nicht freigeschaltet.

## Order wurde abgelehnt

Pruefe:

- Exchange-Key Rechte.
- Symbol und Market Type.
- Mindestnotional und Mindestmenge.
- Margin und Hebel.
- offene Gegenorders.
- Exchange-spezifische Fehlermeldung.
- Rate Limits.

## Grid Bot startet nicht

Pruefe:

- Template Preview ist bereit.
- Budget reicht fuer Mindestinvestment.
- Liquidationsabstand ist nicht blockiert.
- Funding Vault oder Wallet hat genug USDC.
- HYPE fuer Gas ist vorhanden.
- BotVault Provisioning ist nicht pending.
- Runner ist aktiv.

## Wallet-Aktion bleibt pending

Manche Funding-Flows bestaetigen erst, wenn die Zielbalance erreicht ist. Warte auf Indexer/Balance-Refresh und starte denselben Flow nicht mehrfach.

## FAQ

### Fuehrt eine Prognose automatisch Trades aus?

Nein. Prognosen koennen den Trading Desk vorfuellen. Die Order muss separat geprueft und bestaetigt werden.

### Braucht ein Exchange-Key Withdrawal-Rechte?

Nein. Withdrawal-Rechte sollten nicht aktiviert werden.

### Warum sehe ich einen Admin-Menuepunkt nicht?

Entweder fehlt die Rolle, das Feature Gate ist aus, oder du bist im falschen Workspace.

### Warum stimmen Exchange UI und uLiquid Desk kurzzeitig nicht ueberein?

Exchange APIs, Websockets, Indexer und interne Reconciliation koennen leicht unterschiedliche Timings haben. Bei Abweichungen keine neuen Live-Aktionen starten und gegen die Exchange UI pruefen.

### Was ist ein Canary?

Ein kleiner Live-Test mit begrenztem Kapital, klarem Scope und engem Monitoring.
