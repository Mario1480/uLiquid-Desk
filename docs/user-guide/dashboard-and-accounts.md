---
description: Dashboard, Account-Karten, Alerts und Exchange-Account Einrichtung.
icon: gauge
---

# Dashboard und Exchange-Accounts

Das Dashboard ist die operative Startseite. Es zeigt Kontostatus, Performance, offene Positionen, Alerts, Wallet-Snapshot, Bots, Grid Bots, Kalender und News.

## Dashboard lesen

Pruefe zuerst die Account-Karten:

- Status: verbunden, eingeschraenkt oder getrennt.
- Letzte Synchronisierung.
- Equity, verfuegbare Margin und heutiges PnL.
- Offene Positionen und Bot-/Prediction-Aktivitaet.
- Alerts oder Fehlerhinweise.

Wenn Daten eingeschraenkt sind, sollten riskante Aktionen nicht gestartet werden.

## Exchange-Account anlegen

1. Oeffne **Einstellungen**.
2. Wechsle zu **Exchange-Accounts**.
3. Lege einen neuen Account an.
4. Waehle Exchange, Label und benoetigte Credentials.
5. Speichere nach Re-Auth.
6. Pruefe den Account im Dashboard.

## API-Key Mindestregeln

- Keine Withdrawal-Rechte aktivieren.
- Nur benoetigte Trading- und Read-Rechte vergeben.
- IP-Whitelist pflegen, falls genutzt.
- Einen klaren Namen pro Workspace/Umgebung verwenden.

## Typische Statusmeldungen

| Status | Bedeutung | Naechster Schritt |
| --- | --- | --- |
| Verbunden | Daten werden erfolgreich gelesen. | Normal weiterarbeiten. |
| Eingeschraenkt | Mindestens eine Datenquelle ist unsicher oder teilweise ausgefallen. | Keine neuen Live-Aktionen starten, Ursache pruefen. |
| Getrennt | Account kann nicht gelesen werden. | API-Key, Exchange, Netzwerk und Berechtigungen pruefen. |

## Offene Positionen

Die Positionsuebersicht zeigt Side, Groesse, Entry, Stop Loss, Take Profit und PnL. Bei degradierter Market-Data-Lage bleiben letzte sichere Daten sichtbar und Trading-Aktionen koennen blockiert sein.

## News und Kalender

Der Wirtschaftskalender und Markt-News helfen, Marktphasen einzuordnen. Sie ersetzen keine eigene Risikoentscheidung.
