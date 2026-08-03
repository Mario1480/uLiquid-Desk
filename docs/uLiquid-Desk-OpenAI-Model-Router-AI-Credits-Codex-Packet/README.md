# uLiquid Desk – OpenAI Model Router & AI Credits

Dieses Paket ergänzt den geplanten AI Agent Chat um eine produktionsfähige OpenAI-Modellsteuerung und eine kostenbasierte AI-Credit-Abrechnung.

## Verbindliche Produktentscheidungen

- Vorerst ausschließlich OpenAI als AI-Provider.
- Nutzer wählen weder Provider noch konkretes Modell.
- Serverseitiger Router nutzt GPT-5 nano, GPT-5.6 Luna, Terra oder Sol.
- Monatsabo bezahlt Plattformzugang und Features, nicht unbegrenzte AI-Nutzung.
- OpenAI-Nutzung wird aus einem Prepaid-AI-Credit-Guthaben bezahlt.
- Das bisherige Token-Guthaben wurde nie produktiv genutzt. Es gibt keine Legacy-Migration, kein Dual-Write und keinen Kompatibilitätsmodus.
- AI erzeugt weiterhin keine unkontrollierten Exchange-Aktionen. Trading-Aktionen bleiben Drafts bzw. laufen durch deterministische Risk Gates und Bestätigung.

## Aktuell bestätigte OpenAI-Preise (Stand 3. August 2026)

Preise pro 1 Mio. Text-Tokens:

| Modell | Input | Cached Input | Output | Einsatz |
|---|---:|---:|---:|---|
| GPT-5 nano | $0.05 | $0.005 | $0.40 | sehr einfache Utility-Aufgaben |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 | Standard-Agent, hohe Stückzahl |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 | anspruchsvolle Analysen |
| GPT-5.6 Sol | $5.00 | $0.50 | $30.00 | Deep Analysis, Strategien, kritische Planung |

Zusatzregeln für GPT-5.6:

- Requests mit mehr als 272K Input-Tokens: 2x Input- und 1,5x Outputpreis für den gesamten Request.
- Cache Writes: 1,25x des normalen Inputpreises.
- Cache Reads: 90 % Rabatt gegenüber normalem Input.
- Tool-spezifische OpenAI-Gebühren müssen separat in der Preis-Registry abbildbar sein.

## Empfohlene Reihenfolge

1. `CODEX-MASTER-PROMPT.md` lesen.
2. Agent 01 bis 07 in Reihenfolge ausführen.
3. Nach jedem Agenten Tests und Typecheck ausführen.
4. Kein Agent darf eigenmächtig autonome Trade Execution aktivieren.

## Paketstruktur

- `CODEX-MASTER-PROMPT.md` – Gesamtauftrag und harte Leitplanken
- `specs/01-current-state.md` – belegter Repository-Iststand
- `specs/02-model-routing.md` – Routingregeln und Modellklassen
- `specs/03-credit-billing.md` – Credit-Ökonomie und Abrechnung
- `specs/04-data-model.md` – Ziel-Datenmodell
- `specs/05-api-ui.md` – API- und UI-Anforderungen
- `specs/06-security-observability.md` – Limits, Audit und Betrieb
- `specs/07-rollout-tests.md` – Tests und Rollout
- `agents/` – getrennte Codex-Arbeitspakete
- `examples/` – Konfigurations- und Schemaentwürfe
