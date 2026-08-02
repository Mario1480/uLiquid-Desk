# Agent 05 – Read-only AI Position Copilot

## Auftrag

Implementiere einen read-only AI Position Copilot für Spot- und Perpetual-Positionen. Er erklärt Risiken und Marktveränderungen, handelt aber niemals selbst.

## Harte Grenzen

Der Copilot darf nicht:

- Orders erstellen oder absenden
- Positionen schließen oder reduzieren
- Stop-Loss oder Take-Profit ändern
- Leverage oder Margin ändern
- Prediction-Copier-Regeln verändern
- Wallet-Transaktionen signieren

Buttons dürfen nur zu manuellen Review-Oberflächen navigieren.

## Anforderungen

- minimales Snapshot DTO ohne Secrets
- strukturiertes Analyse-Ergebnis mit Risk Level, Thesis Status, Risk Factors, Events und Datenqualität
- event- und zeitbasierte Trigger
- Cache, Snapshot-Hash und Deduplizierung
- Nutzeroptionen für Critical only, Important changes, Periodic summary und Off
- In-App und Telegram
- Kosten- und Rate-Limits
- Audit Trail

## Interaktion mit Prediction Copier

Der Copilot darf anzeigen, ob eine Position vom Prediction Copier eröffnet wurde. Er darf jedoch weder die Copier-Regel ändern noch automatisch eine Gegenorder oder Positionsanpassung auslösen.

## Tests

- Snapshot enthält keine Secrets
- keine Trading- oder Copier-Write-Tools
- Trigger-Cooldown
- identischer Snapshot wird dedupliziert
- kritische Liquidationsdistanz
- Spot ohne Liquidationspreis
- degraded Daten
- CTA navigiert nur

## Akzeptanzkriterien

- verständliche read-only Risikohinweise
- keine Ausführungspfade
- Kosten und Benachrichtigungen kontrolliert
- Datenqualität sichtbar
