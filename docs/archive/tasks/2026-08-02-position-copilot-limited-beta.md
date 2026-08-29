# Position Copilot – Limited Beta Nachweis

Stand: 2026-08-02

## Ergebnis

Der Trading Desk enthält einen read-only Position Copilot für Spot- und Perpetual-Positionen. Er verarbeitet ausschließlich ein minimales, serverseitig normalisiertes Positions-Snapshot und besitzt keine Trading-, Copier- oder Wallet-Tools.

## Architektur und Sicherheitsgrenzen

- `POST /api/position-copilot/analyze` prüft Session und Eigentum des Exchange-Kontos.
- Das Request-Schema ist strikt. API Keys, Secrets, Passphrases und Wallet-Daten sind weder zulässige Felder noch Teil des AI-Prompts oder Audit-Payloads.
- Der AI-Aufruf verwendet `toolChoice: none` und eine leere Tool-Liste. Unerwartete Tool Calls werden verworfen und durch die deterministische read-only Analyse ersetzt.
- Die deterministische Analyse kann eine AI-Risikoeinstufung nicht nach unten korrigieren lassen und bleibt bei Provider-, Billing- oder Rate-Limit-Problemen verfügbar.
- Kosten werden durch AI-Billing-Zuordnung, 650 Output-Token, fünf Minuten Cache und maximal zwölf neue Copilot-AI-Aufrufe pro Minute begrenzt.
- Snapshot-Hash, persistenter Trigger-Status und Cooldown verhindern identische oder zu häufige Hinweise. Der Trading Desk löst Event-Analysen nur beim Wechsel relevanter Risikobänder und zeitbasierte Analysen im Modus `Periodic summary` aus.
- `Critical only`, `Important changes`, `Periodic summary` und `Off` sowie In-App und Telegram sind nutzerkontrollierte Einstellungen.
- Jede ausgeführte Analyse wird als `AiTraceLog` mit bereinigtem Snapshot, Ergebnis sowie Cache-/Fallback-/Rate-Limit-Metadaten protokolliert.
- Eine offene Prediction-Copier-Trade-Historie darf als Herkunft angezeigt werden. Der Copilot besitzt keinen Pfad zum Ändern der Copier-Regel oder Erzeugen einer Gegenorder.
- Die einzige weiterführende CTA navigiert zur manuellen Positionsprüfung im Trading Desk. Analyse und Benachrichtigung führen keine Execution-API aus.

## Geänderte Bereiche

- `apps/api/src/position-copilot/`
- `apps/api/src/plugins/notificationHost.ts`
- `apps/api/src/plugins/notifications/telegramNotificationPlugin.ts`
- `apps/api/src/index.ts`
- `apps/web/app/trade/page.tsx`
- `apps/web/app/styles/desk.css`
- `apps/web/messages/de/system.json`
- `apps/web/messages/en/system.json`
- `docs/uLiquid-Desk-Codex-Limited-Beta-Plan-v2/README.md`

## Automatisierte Prüfungen

- API TypeScript: `npm -w apps/api run typecheck`
- Web TypeScript (direkt, da Next `typegen` lokal ohne Ausgabe hing): `node ../../node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` in `apps/web`
- i18n: `npm -w apps/web run i18n:check`
- Copilot Unit Tests: `node --import tsx --test apps/api/src/position-copilot/*.test.ts`
- UI Safety Test: `node --import tsx --test apps/web/src/trade/positionCopilot.test.ts`
- Repository Hygiene: `git diff --check`

## Manueller Smoke-Test

1. Trading Desk mit einem Konto und einer offenen Spot- oder Perpetual-Position öffnen.
2. Position auswählen und prüfen, dass Risk Level, Thesis Status, Datenqualität und Risikofaktoren erscheinen.
3. `Analyse aktualisieren` auslösen und verifizieren, dass keine Order-, TP/SL-, Leverage-, Margin-, Copier- oder Wallet-Anfrage entsteht.
4. `Position manuell prüfen` verwenden und verifizieren, dass nur zur Positionsliste im Trading Desk navigiert wird.
5. Alle vier Benachrichtigungsmodi speichern; In-App und Telegram separat ein-/ausschalten.
6. Eine eingeschränkte Datenantwort und eine Perpetual-Position mit enger Liquidationsdistanz prüfen; die UI muss `eingeschränkt` beziehungsweise `kritisch` sichtbar machen.
7. Bei konfiguriertem Telegram-Konto einen relevanten Risikowechsel auslösen und den read-only Hinweis kontrollieren.

## Bekannte Restpunkte

- Event- und Zeit-Trigger werden in dieser Ausbaustufe durch einen geöffneten Trading Desk angestoßen. Ein dauerhaft serverseitiger Background-Scanner gehört nicht zum implementierten Limited-Beta-Pfad.
- Der normale Web-Typecheck blieb im lokalen Next-Typegen-Schritt ohne Ausgabe hängen; der eigentliche TypeScript-Check und der i18n-Check waren erfolgreich.
