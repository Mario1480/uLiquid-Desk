# Agent 03 – AI Prediction Builder Chat

## Auftrag

Optimiere den bestehenden AI Chat zum spezialisierten Prediction Builder Assistant. Nutzer sollen Prediction Templates strukturiert erstellen, testen und speichern können.

## Sicherheitsprinzip

Der Builder erstellt Analysevorlagen. Er darf keine Orders senden, Positionen verändern, Copier-Regeln aktivieren, Bots starten, Wallet-Transaktionen signieren oder API-Keys verwalten.

## Zielworkflow

1. Nutzer beschreibt die Analyse.
2. Assistant erzeugt einen strukturierten Draft.
3. UI zeigt Draft neben dem Chat.
4. Änderungen bleiben im Draft.
5. Nutzer führt Preview aus.
6. Nutzer speichert das Template.
7. Eine optionale Nutzung im Prediction Copier erfolgt anschließend in einem separaten Copier-Review-Flow.

## Sichtbare Zustände

- Conversation Draft
- Structured Template Draft
- Preview Result
- Saved Template
- Published Template, falls vorhanden

## Anforderungen

- versioniertes Draft-Schema
- strukturierte Tool-Ausgaben
- Draft Diff mit Übernehmen/Verwerfen
- Preview ohne aktive Prediction oder Order
- Validierung von Timeframes, Horizon, Indikatoren, Long/Short/No-Trade-Regeln und Preisleveln
- explizite Trennung zwischen Template speichern und Copier konfigurieren
- keine automatische Copier-Aktivierung

## Erlaubte Tools

- `create_template_draft`
- `update_template_draft`
- `validate_template_draft`
- `explain_template_field`
- `request_preview`

Keine Trading- oder Copier-Write-Tools.

## Tests

- Freitext erzeugt validierten Draft
- widersprüchliche Regeln werden abgelehnt
- Preview erzeugt keine aktive Prediction
- Speichern erfordert Bestätigung
- keine Copier-Aktivierung aus dem Chat
- Prompt Injection erweitert keine Rechte

## Akzeptanzkriterien

- Chat und Formular verwenden denselben Draft.
- Änderungen sind nachvollziehbar und reversibel.
- Preview bleibt ohne Live-Ausführung.
- Copier-Konfiguration ist ein separater Nutzerprozess.
