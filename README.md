# uLiquid Desk

Multi-tenant Futures Trading Platform mit:
- Web App (Next.js)
- API (Express + Prisma)
- Runner Worker (Bot-Orchestrierung)
- PostgreSQL + Redis
- Bitget Futures Integration
- AI-Predictions + Trading-Desk Prefill
- Telegram Notifications für handelbare Signale

## Architektur

Browser -> Web (3000)
Browser -> API (4000 dev / 8080 prod)
Runner -> API/DB/Redis
API/Runner -> Postgres + Redis + Exchange APIs

Mehr Architektur-Kontext:

- `docs/execution-platform-foundation.md`
- `docs/exchange-capability-matrix.md`
- `docs/paper-connector-architecture.md`
- `docs/ts-python-grid-contract.md`
- `docs/regression-matrix.md`

## Package Manager

Dieses Repository ist auf `npm workspaces` standardisiert.

Bitte nur `npm` verwenden (kein `pnpm`/`yarn`), damit es keine Lockfile- und Resolver-Mismatches gibt.

## Smart Contracts (Foundry)

Das Monorepo enthält ein eigenes Contracts-Workspace unter `packages/contracts` (`@mm/contracts`).

Voraussetzung:
```bash
foundryup
```

Setup (npm-first):
```bash
npm install --workspaces --include-workspace-root --legacy-peer-deps
```

Contracts bauen und testen:
```bash
npm run contracts:build
npm run contracts:test
```

Kern-Regressionsmatrix für Exchange/Paper/Grid/Runner:
```bash
npm run regression:core
```

Direkt im Workspace:
```bash
npm -w packages/contracts run build
npm -w packages/contracts run test
```

Deploy (Foundry Script):
```bash
# local/anvil
npm -w packages/contracts run deploy:local

# devnet (ENV nötig)
RPC_URL=...
PRIVATE_KEY=...
USDC_ADDRESS=...
DEPLOY_OWNER=0x...
FORGE_BROADCAST_ARGS=--legacy
npm -w packages/contracts run deploy:devnet
```

VPS helper script:
```bash
./scripts/deploy_contracts_vps.sh --mode devnet --env-file .env.prod
npm run contracts:deploy:vps
```
Details: `docs/contracts-vps-deploy.md`

## Schnellstart lokal (Docker)

1. `.env` anlegen:
```bash
cp .env.example .env
```

Optional bei Port-Konflikten (z. B. `3000` bereits belegt):
```bash
# .env
WEB_PORT=3001
API_PORT=4000
POSTGRES_PORT=5433
```

2. Stack starten:
```bash
npm run docker:dev:up
```

3. Erreichbarkeit prüfen:
```bash
curl -i http://localhost:${API_PORT:-4000}/health
open http://localhost:${WEB_PORT:-3000}
```

4. Account erstellen:
- Web: `http://localhost:${WEB_PORT:-3000}/register`

5. Logs:
```bash
npm run docker:dev:logs
```

## Production Deploy (VPS)

Voraussetzungen:
- Ubuntu 22.04+
- DNS auf VPS-IP
- Ports `22`, `80`, `443` offen

Kanonische Production-Ziele:
- Web: `https://desk.uliquid.vip`
- API: `https://api.desk.uliquid.vip`
- DNS A-Records zeigen auf `185.216.213.200`

### Option A: Installer Script (empfohlen)

```bash
curl -fsSL https://raw.githubusercontent.com/Mario1480/uLiquid-Desk/main/scripts/install_vps.sh -o /tmp/install_vps.sh
chmod +x /tmp/install_vps.sh
sudo /tmp/install_vps.sh
```

Das Script:
- installiert Docker + Firewall + optional offizielles Caddy (apt + systemd)
- klont Repo nach `/opt/uliquid-desk` (Default)
- erzeugt `.env.prod` aus `.env.prod.example` und setzt nur die aktuellen Prod-Keys
- startet `docker-compose.prod.yml`

### Option B: manuell

Siehe `docs/PRODUCTION_DEPLOY.md`.
Start mit:

```bash
cp .env.prod.example .env.prod
bash ./scripts/sync_env_files.sh --target .env.prod
```

`sync_env_files.sh` ergänzt bei `.env.prod` nur noch fehlende Prod-Keys aus `.env.prod.example`, damit keine alten Dev-/Legacy-Keys in neue VPS-Setups nachgezogen werden.

Beim Deploy über `./scripts/deploy_prod.sh` wird der Sync automatisch ausgeführt.

### Caddy Standard

Produktionsserver sollen Caddy nur noch über das offizielle `apt`-Repo betreiben:
- Config: `/etc/caddy/Caddyfile`
- Logs: `journalctl -u caddy`
- Service: `systemctl enable --now caddy`
- Typisches Domain-Schema:
  - Web: `desk.uliquid.vip`
  - API: `api.desk.uliquid.vip`
  - Server-IP: `185.216.213.200`

Hilfsskripte:

```bash
sudo bash ./scripts/install_caddy_apt.sh
sudo bash ./scripts/ensure_caddy_systemd.sh
sudo bash ./scripts/migrate_snap_caddy.sh
```

Normale Server-Updates via `sudo ./scripts/deploy_prod.sh` ziehen die Caddy-Prüfung und eine Snap->apt-Migration jetzt automatisch mit.

Self-healing:

```bash
sudo systemctl status caddy-self-heal.timer --no-pager
```

## Wichtige ENV-Variablen

Core:
- `DATABASE_URL`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `NEXT_PUBLIC_WEB3_TARGET_CHAIN_ID` (`999` für HyperEVM)
- `NEXT_PUBLIC_HYPEREVM_RPC_URL`
- `NEXT_PUBLIC_HYPEREVM_EXPLORER_URL`
- `API_BASE_URL`
- `PANEL_BASE_URL` (optional, für Telegram Deep-Link direkt in den Manual Trading Desk)
- `CORS_ORIGINS`
- `SECRET_MASTER_KEY` (Pflicht für Secret-Verschlüsselung)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Trading:
- `BITGET_REST_BASE_URL`
- `BITGET_PRODUCT_TYPE`
- `BITGET_MARGIN_COIN`

Queue/Runner:
- `ORCHESTRATION_MODE=queue`
- `REDIS_URL`
- `WORKER_CONCURRENCY`

Futures Grid v1.3 (Min Investment + Liq Gate + Auto-Margin Policy):
- `FUTURES_GRID_V1`
- `PY_GRID_ENABLED`
- `PY_GRID_URL`
- `PY_GRID_AUTH_TOKEN`
- `PY_GRID_TIMEOUT_MS`
- `GRID_MIN_INVEST_FEE_BUFFER_PCT` (default `1.0`)
- `GRID_LIQ_MMR_DEFAULT_PCT` (default `0.75`)
- `GRID_LIQ_DISTANCE_MIN_PCT` (default `8`)
- `GRID_FEE_RATE_FALLBACK_PCT` (default `0.06`)
- `GRID_MIN_NOTIONAL_FALLBACK_USDT` (default `5`)
- `GRID_AUTO_MARGIN_SUPPORTED_EXCHANGES` (default `hyperliquid`)
- `GRID_ALLOWED_EXCHANGES` (default `paper`; later e.g. `paper,hyperliquid`)
- `NEXT_PUBLIC_GRID_ALLOWED_EXCHANGES` (default `paper`; filters Grid Create account dropdown)
- `GRID_ORDER_BATCH_SIZE` (default `48`; execution intents per tick in order `cancel -> replace -> place`)
- `GRID_VENUE_CACHE_TTL_SEC` (default `120`)
- `GRID_AUTO_MARGIN_DEFAULT_TRIGGER_PCT` (default `3`)

AI Predictions:
- `AI_PROVIDER` (`openai`, `ollama`, `disabled`)
- `AI_BASE_URL` (`https://api.openai.com/v1` oder `http://localhost:11434/v1`)
- `AI_API_KEY`
- `AI_SIGNAL_ENGINE` (`legacy` default, `agent_v1` für Tool-Calling-Agent)
- `AI_SIGNAL_ENGINE_OLLAMA` (optional; `legacy` nur als Kompatibilitäts-Override)
- `AI_PAYLOAD_PROFILE_MODE` (`legacy` default, `minimal_v1` oder `minimal_v2` für mode-spezifische Minimal-Payloads)
- `AI_MODEL`
- `AI_OLLAMA_4H_MIN_EXPLANATION_CHARS` (default `420`)
- `AI_OLLAMA_4H_MIN_EXPLANATION_SENTENCES` (default `8`)
- `AI_AGENT_MAX_TOOL_ITERATIONS` (default `3`)
- `AI_TOOL_TIMEOUT_MS`
- `AI_TOOL_CACHE_TTL_MS`
- `AI_TOOL_RATE_LIMIT_PER_MIN`
- `FEATURE_THRESHOLDS_CALIBRATION_ENABLED`
- `FEATURE_THRESHOLDS_SYMBOLS`
- `FEATURE_THRESHOLDS_TIMEFRAMES`
- `FEATURE_THRESHOLDS_WINSORIZE_PCT`
- Refresh Scheduler v1:
  - `PREDICTION_REFRESH_ENABLED`
  - `PREDICTION_REFRESH_MAX_RUNS_PER_CYCLE`
  - `PREDICTION_REFRESH_AI_COOLDOWN_SECONDS`
  - `PREDICTION_REFRESH_5M_SECONDS`
  - `PREDICTION_REFRESH_15M_SECONDS`
  - `PREDICTION_REFRESH_1H_SECONDS`
  - `PREDICTION_REFRESH_4H_SECONDS`
  - `PREDICTION_REFRESH_1D_SECONDS`
  - Details: `docs/prediction-refresh-scheduler.md`
  - `market_analysis` auto-updates are cadence-guarded to at least the prompt `runTimeframe` window (manual runs can still execute immediately)
- Evaluator v1:
  - `PREDICTION_EVALUATOR_ENABLED`
  - `PREDICTION_EVALUATOR_POLL_SECONDS`
  - `PREDICTION_EVALUATOR_BATCH_SIZE`
  - `PREDICTION_EVALUATOR_SAFETY_LAG_SECONDS`
  - Details: `docs/prediction-evaluator.md`
- Bot Entry Gating (Prediction filter only, no auto-trading):
  - `PREDICTION_GATE_FAIL_OPEN` (`false` default)
  - Gate-Config liegt je Bot in `futuresConfig.paramsJson.gating`

Lokales Ollama-Setup (OpenAI-kompatibler Chat-Completions Transport):
```bash
ollama pull qwen3:8b
```
```env
AI_PROVIDER=ollama
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=qwen3:8b
AI_API_KEY=ollama
AI_SIGNAL_ENGINE=agent_v1
AI_PAYLOAD_PROFILE_MODE=legacy
# optional:
# AI_SIGNAL_ENGINE_OLLAMA=legacy
```

Salad Cloud Ollama via OpenAI-Compat Proxy:
```bash
docker compose -f docker-compose.dev.yml up -d salad-proxy
curl http://localhost:8088/health
```
Production stack includes `salad-proxy` in `docker-compose.prod.yml` (internal network only):
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api wget -qO- http://salad-proxy:8088/health
```
Admin-Werte (wichtig: aus Sicht des API-Containers, nicht `localhost`):
- `Provider`: `ollama`
- `Base URL`: `http://salad-proxy:8088/v1`
- `Model`: `qwen3:8b`
- `AI API key`: `salad_cloud_user_...`

Salad Runtime Control (manuell, im Admin-Backend):
- In `/admin/api-keys` unter `Salad Runtime Control` Ziel setzen:
  - `Salad API Base URL` (default `https://api.salad.com/api/public`)
  - `Organization`, `Project`, `Container`
- Danach über Buttons:
  - `Runtime-Status aktualisieren`
  - `Container starten`
  - `Container stoppen`
- So kannst du den Container in Testphasen gezielt stoppen, um Kosten zu sparen.

Ollama Prompt-Fit Runtime:
- Es werden keine separaten Prompt-Kopien gepflegt; provider/timeframe-spezifische Runtime-Hints werden an den System-Prompt angehängt.
- Für `4h + market_analysis` wird eine lange Analyse erzwungen (8-12 Sätze, Fließtext).
- Für `4h + market_analysis` wird die Erklärung in 3 Absätzen formatiert (jeweils mit Leerzeile getrennt), für Ollama und OpenAI.
- Wenn `marketAnalysisUpdateEnabled=true` bei `4h`, wird `aiPrediction` neutral-only normalisiert (`neutral/0/0`).

Payload Profiles:
- `AI_PAYLOAD_PROFILE_MODE=legacy` lässt das bisherige Payload-Format unverändert.
- `AI_PAYLOAD_PROFILE_MODE=minimal_v1` trennt Payloads strikt nach Modus:
  - `trading_explainer`: mit `prediction`/Setup-Kontext.
  - `market_analysis`: ohne directional/setup Felder.
- `AI_PAYLOAD_PROFILE_MODE=minimal_v2` nutzt die Feldtrennung aus `minimal_v1` und reduziert zusätzlich große Arrays vor dem Budget-Trimming:
  - `trading_explainer`: `ohlcvSeries<=80`, `historyContext.ev<=20`, `historyContext.lastBars.ohlc<=20`, nur MTF-Run-Timeframe.
  - `market_analysis`: `ohlcvSeries<=60`, `historyContext.ev<=12`, `historyContext.lastBars.ohlc<=16`, nur MTF-Run-Timeframe.
- Prompt-Scaffolding wird in `minimal_v1` nicht mehr im User-Payload gesendet, sondern über System-Instruktionen geführt.

Prompt-Mode UX (alle Prompt-Editoren):
- Neuer kompatibler Feldwert `promptMode`: `trading_explainer` oder `market_analysis`.
- Persistenz bleibt kompatibel über `marketAnalysisUpdateEnabled`; Server mappt beide Richtungen.
- Für `market_analysis` werden Trading-Felder serverseitig erzwungen auf:
  - `directionPreference=either`
  - `confidenceTargetPct=60`
  - `slTpSource=local`
  - `newsRiskMode=off`
- Im UI wird der Modus zuerst gewählt; Trading-spezifische Felder sind in Analyse-Modus ausgeblendet und werden beim Umschalten auf Analyse auf Defaults zurückgesetzt.

Economic Calendar (FMP) + News Blackout:
- `FMP_API_KEY` (optional ENV fallback; preferred via Admin-UI)
- `FMP_BASE_URL` (optional, default `https://financialmodelingprep.com`)
- `ECON_NEWS_RISK_ENABLED` (`1` default, `0` disables newsRisk gating/prediction flagging)
- `ECON_CALENDAR_REFRESH_ENABLED` (`1` default)
- `ECON_CALENDAR_REFRESH_INTERVAL_MINUTES` (default `15`)
- `ECON_REDIS_EVENTS_TTL_SEC`
- `ECON_REDIS_NEXT_TTL_SEC`
- `ECON_REDIS_BLACKOUT_TTL_SEC`

Prediction Indicator Pack v1 (backend, deterministic from OHLCV):
- RSI(14), MACD(12/26/9), Bollinger(20/2), ADX(14), ATR(14)/close
- VWAP:
  - intraday (`5m`,`15m`,`1h`,`4h`) = `session_utc` VWAP (UTC day reset)
  - `1d` = `rolling_20` VWAP
- Session VWAP cache:
  - `VWAP_SESSION_CACHE_TTL_MS` (default `120000`)
  - `VWAP_SESSION_GAP_THRESHOLD` (default `0.03`)

Billing / Subscription (CCPayments):
- Billing feature flags are managed in Admin Backend (`/admin/billing`)
- `CCPAY_APP_ID`
- `CCPAY_APP_SECRET`
- `CCPAY_BASE_URL`
- `CCPAY_PRICE_FIAT_ID`
- `WEB_BASE_URL`
- `BILLING_PRO_MONTHLY_PRICE_CENTS`
- `BILLING_PRO_MONTHLY_AI_TOKENS`
- `BILLING_AI_TOPUP_PRICE_CENTS`
- `BILLING_AI_TOPUP_TOKENS`

License Gate (internal, subscription-backed):
- `LICENSE_ENFORCEMENT`

Telegram:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- alternativ in der UI: `/settings/notifications`

SMTP:
- alternativ per Admin-UI: `/admin` -> SMTP

## Nützliche URLs

- Web: `http://localhost:3000`
- API Health (dev): `http://localhost:4000/health`
- API Health (prod): `http://<api-domain>/health`
- Manual Trading Desk: `/trade`
- Predictions: `/predictions`
- Economic Calendar: `/calendar`
- Prediction metrics API: `/api/predictions/metrics?bins=10`
- Thresholds API (latest): `/api/thresholds/latest?exchange=bitget&symbol=BTCUSDT&marketType=perp&tf=15m`
- Economic Calendar API:
  - `GET /economic-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&impact=high&currency=USD`
  - `GET /economic-calendar/next?currency=USD&impact=high`
  - `GET /economic-calendar/config`
  - `PUT /economic-calendar/config` (superadmin)
  - Default currencies (refresh/config fallback): `USD,EUR,GBP,JPY,CHF,CAD,AUD,NZD,CNY`
- Telegram Settings: `/settings/notifications`
- Admin Backend: `/admin` (Superadmin)
- Global AI Provider Key (encrypted DB): `/admin/api-keys`
- Global FMP Key (encrypted DB): `/admin/api-keys`
- Indicator Settings (global/account/symbol/tf overrides): `/admin/indicator-settings`
- Paper Trading Smoke Test: `docs/paper-trading-smoke-test.md`
- Paper Connector Architecture: `docs/paper-connector-architecture.md`
- Execution Platform Foundation: `docs/execution-platform-foundation.md`

## Manual Trading Desk Chart

Der Trading-Desk verwendet aktuell `lightweight-charts` (Node/TS, ohne native Abhängigkeiten):
- Candlestick-Chart im Manual Trading Desk
- Datenquelle: `GET /api/market/candles`
- Polling-Refresh für neue Kerzen (MVP)

Damit die Kerzen erscheinen, muss die API erreichbar sein (`/api/market/candles`) und ein gültiger Exchange-Account gewählt sein.
Für `Paper (Simulated Trading)` muss zusätzlich ein echtes Exchange-Konto als Marktdatenquelle hinterlegt sein.

## Bot Prediction Gate (Entry Filter)

Der Runner nutzt optional ein Prediction-Gate für **Entry-Intents** (`intent.type === "open"`):

- Gate blockiert oder erlaubt Entries auf Basis von `predictions_state`
- Gate skaliert optional die Positionsgröße (`sizeMultiplier`)
- Strategien bleiben führend; es gibt **kein** Auto-Trading nur durch Predictions

Beispiel `paramsJson` für Trend-Bot:

```json
{
  "gating": {
    "enabled": true,
    "timeframe": "15m",
    "minConfidence": 70,
    "allowSignals": ["up"],
    "blockTags": ["news_risk", "low_liquidity"],
    "maxAgeSec": 900,
    "sizeMultiplier": {
      "base": 1.0,
      "highConfidenceThreshold": 80,
      "highConfidenceMultiplier": 1.2,
      "highVolMultiplier": 0.7,
      "min": 0.1,
      "max": 2.0
    }
  }
}
```

## Bot v1: Prediction Copier (Perp, enter_exit)

Der Runner unterstützt jetzt zusätzlich `strategyKey: "prediction_copier"`:
- liest Signale aus `predictions_state` (pro `exchange/account/symbol/timeframe`)
- unterstützt `bitget` und `paper` (bei `paper` kommen Marktdaten aus dem verknüpften Live-CEX-Konto)
- **enter_exit** Logik:
  - Entry auf frische `up/down` Signale
  - Exit bei `signal_flip`, `neutral` oder Confidence-Drop
  - kein sofortiges Reverse im selben Tick (Cooldown + neuer `prediction_hash` nötig)
- persistenter Bot-State in `bot_trade_state` (Idempotenz + Daily-Counter)

Beispiel `paramsJson`:

```json
{
  "predictionCopier": {
    "timeframe": "15m",
    "minConfidence": 70,
    "maxPredictionAgeSec": 600,
    "symbols": ["BTCUSDT"],
    "positionSizing": { "type": "fixed_usd", "value": 100 },
    "risk": {
      "maxOpenPositions": 3,
      "maxDailyTrades": 20,
      "cooldownSecAfterTrade": 120,
      "maxNotionalPerSymbolUsd": 500,
      "maxTotalNotionalUsd": 1500,
      "maxLeverage": 3,
      "stopLossPct": null,
      "takeProfitPct": null,
      "timeStopMin": null
    },
    "filters": {
      "blockTags": ["news_risk", "data_gap", "low_liquidity"],
      "requireTags": null,
      "allowSignals": ["up", "down"],
      "minExpectedMovePct": null
    },
    "execution": {
      "orderType": "market",
      "limitOffsetBps": 2,
      "reduceOnlyOnExit": true
    }
  }
}
```

Beispiel `paramsJson` für Mean-Reversion-Bot:

```json
{
  "gating": {
    "enabled": true,
    "timeframe": "5m",
    "minConfidence": 60,
    "allowSignals": ["up", "down"],
    "blockTags": ["breakout_risk", "news_risk"],
    "maxAgeSec": 600,
    "sizeMultiplier": {
      "base": 0.9,
      "highConfidenceThreshold": 85,
      "highConfidenceMultiplier": 1.1,
      "highVolMultiplier": 0.6
    },
    "failOpenOnError": false
  }
}
```

## Betrieb / Logs

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200 api
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200 web
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f --tail=200 runner
```

## Update / Re-Deploy

```bash
cd /opt/uliquid-desk
./scripts/deploy_prod.sh
```

Optional (ohne `git pull`):

```bash
cd /opt/uliquid-desk
./scripts/deploy_prod.sh --no-pull
```

## Troubleshooting

Login/NetworkError:
- `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, API Health prüfen

Prisma/Migrations:
- API-Logs prüfen (`migrate deploy` läuft beim API-Start)

Trading/Bitget:
- Exchange Account in UI prüfen (`/settings`)
- Passphrase für Bitget ist erforderlich
