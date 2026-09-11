# Paper Trading Smoke Test

Dieser Smoke-Test prueft:
- `paper` Exchange-Account
- Marktdaten ueber verknuepftes Live-CEX-Konto
- Manual Trading (simuliert)
- Runner `prediction_copier` auf `paper`

## Voraussetzungen

- API, Web, Runner laufen (`docker compose -f docker-compose.dev.yml up -d --build`)
- mindestens ein funktionierendes Live-CEX-Konto (z. B. `bitget`) in `/settings`
- Admin hat `paper` in `/admin/exchanges` aktiviert

## 1) Paper-Account anlegen

1. In `/settings` bei **Add Exchange Account**:
   - `Exchange = Paper (Simulated Trading)`
   - Label setzen
   - bei **Market data account** ein echtes CEX-Konto auswaehlen
2. Speichern.
3. Erwartung:
   - Account erscheint in der Liste
   - Eintrag zeigt `Market data: <Live-Account>`

## 2) Verbindung testen

1. Beim neuen Paper-Account auf **Sync now** klicken.
2. Erwartung:
   - Erfolgsmeldung `paper_sync_ok` bzw. Sync erfolgreich
   - kein API-Key-Fehler

## 3) Marktdaten pruefen

1. `/trade` oeffnen und den Paper-Account auswaehlen.
2. Erwartung:
   - Symbol-Liste laedt
   - Kerzen/Orderbook/Ticker kommen
   - WebSocket verbindet ohne Error

## 4) Manual Paper Trade pruefen

1. Im Trading-Desk eine kleine Market-Order oeffnen.
2. Danach Positionen/Account Summary aktualisieren.
3. Position wieder schliessen.
4. Erwartung:
   - Order wird akzeptiert
   - Position erscheint und verschwindet nach Close
   - Entry-/Exit-Preis kann leicht vom letzten Markpreis abweichen (Paper-Slippage)
   - Account Summary zeigt Fee-Effekt auf Balance/Equity
   - keine echte CEX-Order wird erzeugt

## 5) Resting Limit und Teilfill pruefen

1. Eine kleine Limit-Buy-Order knapp unter dem aktuellen Preis platzieren.
2. Warten, bis der Markt den Preis beruehrt, und Order/Positionen mehrfach aktualisieren.
3. Erwartung:
   - Order bleibt zunaechst als Open Order sichtbar
   - beim ersten Touch kann nur ein Teilfill entstehen
   - Restmenge bleibt offen und wird bei spaeterem Touch weiter reduziert oder voll ausgefuehrt

## 6) Stop-/TP-/SL-Verhalten pruefen

1. Eine kleine Position oeffnen.
2. Fuer die Position TP/SL setzen.
3. Den Markt beobachten oder mit einem Testsymbol arbeiten, das die Schwelle zeitnah beruehrt.
4. Erwartung:
   - TP fuehrt als normales profitables Exit
   - SL/Stop verhaelt sich aggressiver als ein normales Limit und kann zusaetzliche Slippage zeigen
   - nach dem Exit ist die Position geschlossen und ein Paper-Fill sichtbar

## 7) Prediction Copier auf Paper pruefen

1. Bot erstellen:
   - Account = Paper-Account
   - `strategyKey = prediction_copier`
   - Symbol passend zu vorhandenen Prediction States (z. B. `BTCUSDT`)
2. Sicherstellen, dass `predictions_state` fuer denselben `exchange/account/symbol/timeframe` existiert.
3. Bot starten.
4. Erwartung im Runner/API:
   - keine Meldung `prediction_copier_exchange_not_supported`
   - Decisions/Trades als `PREDICTION_COPIER_DECISION` und `PREDICTION_COPIER_TRADE`
   - Open/Close wird im Bot-Trade-State simuliert

## 8) Negative Tests

- Paper ohne Marktdatenkonto anlegen:
  - Erwartung: `paper_market_data_account_required`
- Live-Konto loeschen, das noch von Paper verwendet wird:
  - Erwartung: `exchange_account_in_use_by_paper`
- Paper mit Paper als Marktdatenkonto:
  - Erwartung: `paper_market_data_account_invalid`
- Uebergrosse Position mit zu wenig Paper-Kapital:
  - Erwartung: `paper_margin_insufficient` oder spaeter Liquidation/Margin-Stress im Summary
