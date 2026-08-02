# Agent 04 – Prediction Copier für Limited Beta

## Auftrag

Integriere den bereits getesteten Prediction Copier vollständig und sicher in den Limited-Beta-Produktumfang. Bestehende funktionierende Logik soll nicht neu geschrieben, sondern geprüft, gehärtet und UX-seitig sauber eingebunden werden.

## Produktprinzip

Der Prediction Copier ist eine vom Nutzer ausdrücklich konfigurierte Automationsfunktion. Er darf nur Predictions übernehmen, die alle Nutzer-, Risiko-, Konto- und Datenqualitätsregeln erfüllen.

Er ist keine autonome, frei entscheidende AI-Trading-Funktion.

## Bestehende Implementierung zuerst prüfen

- Copier-Konfiguration und Persistenz
- Runtime/Runner
- Prediction-Selektion
- Order-Erstellung
- Risk Gates
- Exchange Capability Checks
- Deduplizierung und Idempotenz
- Stop-Loss/Take-Profit
- Status und Audit Logs
- Telegram-/In-App-Benachrichtigungen
- bestehende Tests

## Anforderungen

### 1. Onboarding und Aktivierung

Copier-Aktivierung als geführter Review-Flow:

1. Exchange-Konto wählen
2. Spot oder Perpetual wählen
3. erlaubte Symbole definieren
4. Prediction Templates/Quellen definieren
5. Confidence-Schwelle festlegen
6. maximale Positionsgröße festlegen
7. Leverage-Limit festlegen
8. Stop-/Target-Regeln festlegen
9. Tagesverlust- und Exposure-Limits festlegen
10. Zusammenfassung anzeigen
11. explizite Aktivierung bestätigen

Keine Aktivierung durch einen einzelnen CTA aus der Prediction-Seite.

### 2. Zulässigkeitsprüfung

Vor jeder Ausführung prüfen:

- Copier global und für Nutzer aktiv
- Account aktiv und Exchange erreichbar
- Symbol und Markt erlaubt
- Exchange unterstützt benötigte Orderart
- Prediction aktuell und nicht abgelaufen
- Datenqualität ausreichend
- Confidence über Nutzergrenze
- Direction nicht `no_trade`
- Entry/Stop/Targets plausibel
- maximale Position, Exposure und Leverage eingehalten
- Tagesverlustgrenze nicht erreicht
- keine doppelte Verarbeitung derselben Prediction
- Cooldown und maximale Trades pro Zeitraum
- News-/Event-Blocker, falls konfiguriert

### 3. Idempotenz

Jede Prediction darf pro Copier-Regel nur einmal ausgeführt werden. Nutze stabile Idempotency Keys und persistente Execution Records.

### 4. Order Review Record

Vor Ausführung intern persistieren:

- Prediction ID
- Copier Rule ID
- User und Account
- Symbol, Side, Market Type
- geplante Größe
- Entry/Order Type
- Stop und Targets
- Risk-Gate-Ergebnis
- Prediction Snapshot
- Prompt-/Provider-Metadaten, soweit vorhanden
- Idempotency Key

### 5. Ausführung

- vorhandene Trading- und Risk-Services wiederverwenden
- keine parallele Order-Engine bauen
- Exchange Capability Matrix beachten
- Fehlerzustände eindeutig speichern
- Partial Fills und Retry-Verhalten definieren
- kein unkontrollierter Retry bei unbekanntem Orderstatus

### 6. Kill Switches

- globaler Betreiber-Kill-Switch
- Kill-Switch pro Nutzer
- Pause pro Copier-Regel
- automatische Pause bei wiederholten Fehlern
- automatische Pause bei Tagesverlustlimit
- automatische Pause bei degraded Exchange-Daten

### 7. UI

Copier Dashboard:

- Status: Active, Paused, Error, Limit reached
- aktive Regeln
- letzte berücksichtigte Predictions
- ausgeführte und übersprungene Predictions
- Skip-Gründe
- aktuelle Exposure
- täglicher PnL
- nächste verfügbare Aktion
- Pause/Resume mit Bestätigung
- global verständliche Risiko-Hinweise

### 8. Transparenz

Für jede Prediction zeigen:

- kopiert oder übersprungen
- Zeitpunkt
- verwendete Regel
- Ausführungsstatus
- Order IDs
- Skip-/Fehlergrund

Prediction Performance und Copier Trading Performance getrennt auswerten.

### 9. Notifications

Benachrichtigungen für:

- Copier aktiviert/pausiert
- Order erstellt
- Order fehlgeschlagen
- Prediction übersprungen
- Risk Limit erreicht
- automatische Pause

Deduplizierung und Cooldown anwenden.

### 10. Bestehende Payment-Lösung

Keine neue Payment-Abhängigkeit einführen. Bestehende Subscription- und Feature-Berechtigungen nur über die aktuelle Projektlogik prüfen.

## Tests

- berechtigte Prediction wird genau einmal verarbeitet
- `no_trade` wird nie ausgeführt
- abgelaufene Prediction wird übersprungen
- Confidence unter Schwelle wird übersprungen
- Symbol/Markt nicht erlaubt
- Exchange Capability fehlt
- Position-/Exposure-/Leverage-Limit greift
- Tagesverlustlimit pausiert Copier
- unbekannter Orderstatus führt nicht zu Doppelorder
- globaler und Nutzer-Kill-Switch
- Partial Fill
- degraded Exchange-Daten
- Cross-user Zugriff wird abgelehnt
- Audit Trail vollständig

## Akzeptanzkriterien

- Prediction Copier ist in Limited Beta verfügbar.
- Er arbeitet ausschließlich innerhalb bestätigter Nutzerregeln.
- Jede Ausführung ist idempotent, auditiert und risikogeprüft.
- Prediction- und Trading-Performance werden getrennt dargestellt.
- Kill Switches und automatische Pausen funktionieren.
