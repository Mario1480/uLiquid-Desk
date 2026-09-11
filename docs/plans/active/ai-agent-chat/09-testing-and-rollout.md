# Agent 09 – Testing, Rollout und Betriebsfreigabe

## Auftrag

Erstelle eine belastbare Test- und Rollout-Basis für den AI Agent Chat.

## Testebenen

### Unit

- Skill Schemas,
- Venue Resolver,
- Symbol Normalizer,
- Profile Policy,
- Account Binding,
- Conversation Context,
- UI Block Validation,
- Secret Redaction,
- Tool Budget.

### Contract Tests

Für jede Venue dieselben normalisierten Resultate:

- OHLCV,
- Ticker,
- Orderbook,
- Funding,
- Open Interest,
- Contract Info.

### API Integration

- Auth/Ownership,
- Conversations,
- Messages/Runs,
- Profile Reads/Writes,
- Activity,
- Feature Gates,
- Rate Limits,
- degraded provider behavior.

### Web

- View Models,
- Context Bar,
- Skill Drawer,
- Activity Panel,
- responsive States,
- i18n,
- keine unzulässigen Client Requests.

### E2E Smoke

1. Market Analyst ohne Account starten.
2. BTC 1h/4h mit Funding und News analysieren.
3. Source und Activity prüfen.
4. Position Copilot Profil wählen.
5. freigegebenes Hyperliquid/Bitget-Konto auswählen.
6. offene Position analysieren.
7. Cross-account Manipulation simulieren.
8. Provider-Ausfall simulieren und degraded State prüfen.
9. neue Conversation, Reload und History prüfen.
10. Prediction Builder und Prediction Copier Regression prüfen.

## Empfohlene Commands

```bash
npm -w apps/api run typecheck
npm -w apps/api run test:ai
npm -w apps/api run test:market-intelligence
node --import tsx --test apps/api/src/position-copilot/*.test.ts
npm -w apps/web run typecheck
npm -w apps/web run i18n:check
npm -w packages/exchange run typecheck
npm -w packages/futures-exchange run typecheck
npm -w packages/futures-exchange run test
npm run typecheck:node
```

Neue fokussierte Scripts ergänzen, zum Beispiel:

```text
apps/api: test:agent-chat
apps/web: test:agent-chat-ui
packages/market-data: test
```

## Performance-Ziele für MVP

Als Zielwerte, nach Messung anpassen:

- cached public tool p95 < 500 ms,
- uncached einzelne Exchange Reads p95 < 3 s,
- Agent Run ohne Provider-Störung < 20 s,
- Activity Event sichtbar unmittelbar nach Tool Start,
- keine unbeschränkte Conversation-Payload.

## Rollout

### Phase A – Internal

- Admin/Allowlist,
- Market Analyst,
- Binance + Hyperliquid + Bitget,
- kein Account Read für normale Nutzer.

### Phase B – Limited Beta

- Position Copilot Profile,
- explizite Account Freigabe,
- Activity und Audit,
- Degraded States,
- Kostenlimits.

### Phase C – General Read-only

- Custom Profiles,
- weitere Venues,
- Conversation Management,
- UX-Polish.

### Phase D – Optional Trade Drafts

Erst nach separatem Security Review und erfolgreicher Read-only-Betriebsphase.

## Rollback

- serverseitiges `ai_agent_chat` Gate deaktivieren,
- laufende Runs abbrechen,
- Conversations bleiben lesbar oder werden ebenfalls gegated nach Produktentscheidung,
- keine Migration zurückrollen, wenn sie additive Tabellen enthält,
- keine Auswirkung auf Prediction Builder, Predictions, Copier oder Trading Desk.

## Release Blocker

- irgendein direkter Execution Tool Call,
- Cross-user Zugriff,
- Secrets in Logs/DB/UI,
- fehlendes Source/Freshness-Metadatum,
- stiller Venue-Fallback bei Account Reads,
- fehlende Tool Budgets,
- ungeklärte i18n/mobile States,
- Regression im Prediction Copier oder Payment.
