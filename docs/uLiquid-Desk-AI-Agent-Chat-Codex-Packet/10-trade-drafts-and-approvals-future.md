# Agent 10 – Trade Drafts und Approvals – spätere optionale Phase

## Status

Nicht Teil des ersten read-only Releases. Nur starten, wenn Market Analyst, Position Copilot, Audit und Security stabil produktiv laufen und Mario diese Phase ausdrücklich freigibt.

## Grundprinzip

AI erstellt ausschließlich einen **Draft Intent**. Sie führt keine Order aus.

```text
Agent
  → create_action_draft skill
  → strict schema validation
  → deterministic risk preview
  → persisted draft with expiry
  → user opens normal review UI
  → revalidation + optional reauth
  → existing manual trading execution path
```

## Erlaubte Drafts

- Open Order Draft
- Reduce Position Draft
- Close Position Draft
- TP/SL Draft

Nicht erlaubt:

- Wallet Transfers,
- Vault Actions,
- Bot Starts,
- Copier Rule Changes,
- API-Key-Management,
- automatische Draft-Bestätigung.

## Draft Schema

```ts
type AiActionDraftPayload = {
  exchangeAccountId: string; // server bound
  symbol: string;
  marketType: "spot" | "perp";
  action: "open" | "reduce" | "close" | "update_tpsl";
  side?: "long" | "short";
  orderType?: "market" | "limit";
  quantity?: number;
  notionalUsd?: number;
  limitPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  leverage?: number;
  rationale: string;
};
```

Schema-Werte sind Vorschläge, keine ausgeführten Parameter.

## Bestätigung

- Draft expiry 5–15 Minuten,
- one-time confirmation,
- Idempotency Key,
- Account Ownership erneut prüfen,
- aktuellen Preis/Position/Balance neu laden,
- Limits und Capability neu prüfen,
- Risk Engine erneut ausführen,
- UI zeigt Differenz zwischen Draft und aktuellem Markt,
- Nutzer bestätigt in bestehender Trading UI.

## Wichtig

Kein `placeOrder` oder `closePosition` im Agent Runtime Context. Der bestätigte Draft wird in eine normale, bereits abgesicherte serverseitige Manual-Trading-Anfrage übersetzt.

## Tests

- Draft allein erzeugt keine Order,
- abgelaufener Draft kann nicht bestätigt werden,
- Replay wird blockiert,
- veränderter Markt erzwingt erneute Review,
- fremdes Konto wird blockiert,
- Risk Gate kann nicht überschrieben werden,
- UI muss explizit bestätigen,
- Audit verbindet Agent Run, Draft und manuelle Execution.

## Akzeptanzkriterien

- vollständig separate Approval Boundary,
- keine direkte AI Execution,
- bestehende Manual-Trading-Sicherheit wiederverwendet,
- Feature Gate default off.
