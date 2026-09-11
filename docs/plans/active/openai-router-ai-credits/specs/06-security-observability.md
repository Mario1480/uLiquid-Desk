# 06 – Security und Observability

## Sicherheitsgrenzen

- OpenAI-Key ausschließlich serverseitig.
- User-ID, Account-ID und Berechtigungen serverseitig binden.
- Kein Modell erhält Exchange-Secrets.
- Write Skills erzeugen nur Drafts/Intents.
- Risk Gate und Nutzerbestätigung bleiben deterministisch.
- Prompt Injection aus News, Markt- oder Tooldaten darf keine Policy oder Skill-Allowlist verändern.

## Billing-Sicherheit

- Reserve/Settle in DB-Transaktionen.
- Compare-and-swap bzw. atomare Updates gegen Parallelverbrauch.
- Jeder Ledger-Schritt mit Idempotency Key.
- Settlement Worker für unterbrochene Runs.
- Reconciliation Job für ACTIVE Reservierungen mit Timeout.
- Niemals negative Guthaben zulassen.
- Pricing Snapshot nachträglich unveränderbar.

## Datenschutz

In Usage/Billing speichern:

- Scope, Modell, Tokenzahlen, Kosten, Status, Latenz

Nicht speichern:

- API Keys
- vollständige private Kontodaten
- vollständige Chats im Ledger
- Tool-Payloads mit Secrets

## Metriken

- Providerkosten pro Tag/Modell/Scope
- Retail Credits pro Tag/Modell/Scope
- Bruttomarge
- durchschnittliche Kosten pro erfolgreichem Run
- Reserve-vs-Settlement-Abweichung
- Abbruch-/Fehlerrate
- Tool-Runden und Modellaufrufe pro Run
- Luna→Terra/Sol-Eskalationsrate
- P50/P95 Latenz

## Alerts

- Pricing fehlt oder abgelaufen
- Settlement schlägt fehl
- Reservierungen hängen fest
- Kosten pro Run überschreiten Grenzwert
- Marge unter Mindestwert
- ungewöhnlich hoher Sol-Anteil
- OpenAI Usage und interne Usage differieren signifikant
