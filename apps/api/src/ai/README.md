# AI Prediction Explainer

## Purpose
- Generate grounded explanations for baseline predictions.
- Enforce strict JSON schema and safe fallback.
- Never depend on AI output for trading execution.

## Environment Variables
- `AI_PROVIDER` (`openai` default, `ollama`, `vllm`, `off`/`disabled` to disable AI)
- `AI_BASE_URL` (OpenAI: `https://api.openai.com/v1`, Ollama: `http://localhost:11434/v1`, vLLM: `http://localhost:8000/v1`)
- `AI_API_KEY` (required for OpenAI and vLLM; for Ollama a dummy key like `ollama` is supported)
- `AI_MODEL` (OpenAI default: `gpt-4o-mini`, Ollama default: `qwen3:8b`; vLLM requires an explicit served model name)
- `AI_ALLOW_PRIVATE_OLLAMA_BASE_URL` / `AI_ALLOW_PRIVATE_VLLM_BASE_URL` (`1` allows internal/private self-hosted URLs in production)
- `AI_SIGNAL_ENGINE` (`legacy` default, `agent_v1` enables tool-calling agent loop)
- `AI_SIGNAL_ENGINE_OLLAMA` (optional, default auto-agent; set `legacy` only for forced compatibility mode)
- `AI_PAYLOAD_PROFILE_MODE` (`legacy` default, `minimal_v1` or `minimal_v2` for mode-specific minimal payloads)
- `AI_TIMEOUT_MS` (default: `15000`)
- `AI_EXPLAINER_TIMEOUT_MS` (optional override for prediction explainer calls)
- `AI_EXPLAINER_MAX_TOKENS` (default: `650` for prediction explainer calls)
- `AI_EXPLAINER_RETRY_MAX_TOKENS` (default: max(`AI_EXPLAINER_MAX_TOKENS` + 350, 1.5x))
- `AI_GPT5_EXPLAINER_MAX_TOKENS` (default: `3200` for `gpt-5*` explainer calls)
- `AI_GPT5_EXPLAINER_RETRY_MAX_TOKENS` (default: max(`AI_GPT5_EXPLAINER_MAX_TOKENS` + 800, 1.5x))
- `AI_GPT5_EXPLAINER_MAX_ATTEMPTS` (default: `3` for `gpt-5*`, before fallback model is used)
- `AI_GPT5_EXPLAINER_FINAL_MAX_TOKENS` (default: 1.6x retry budget, used on final `gpt-5*` attempt)
- `AI_OLLAMA_4H_MIN_EXPLANATION_CHARS` (default: `200`)
- `AI_OLLAMA_4H_MIN_EXPLANATION_SENTENCES` (default: `8`)
- `AI_PROMPT_OHLCV_MAX_BARS` (default: `500`, min `20`, max `500`) - hard cap for stored OHLCV bars
- `AI_CACHE_TTL_SEC` (default: `300`)
- `AI_RATE_LIMIT_PER_MIN` (default: `60`)
- `AI_AGENT_MAX_TOOL_ITERATIONS` (default: `3`)
- `AI_TOOL_TIMEOUT_MS` (default: `8000`)
- `AI_TOOL_CACHE_TTL_MS` (default: `3000`)
- `AI_TOOL_RATE_LIMIT_PER_MIN` (default: `120`)

## Signal Agent v1 (Tool Calling + Structured Output)
- Uses OpenAI-compatible `POST /chat/completions` transport for OpenAI, Ollama, and vLLM.
- Orchestrator loop:
  - call model with tools + JSON schema
  - execute requested tools in backend
  - append tool results as `tool` messages
  - repeat until final schema-valid response or iteration cap
- Built-in tools:
  - `get_ohlcv`
  - `get_indicators`
  - `get_ticker`
  - `get_orderbook`
- Signal schema (internal):
  - `decision`: `long | short | no_trade`
  - `entry`, `stop_loss`, `take_profit`
  - `confidence` (`0..1`)
  - `reason`
- Final output is mapped back to the existing external prediction contract (`up/down/neutral`).
- Structured schema is runtime-profile aware (`explanation` required, min length adjustable by provider/timeframe profile).

## Runtime Hints (Prompt-Fit)
- Single prompt templates are kept; provider/timeframe hints are appended at runtime.
- For `4h + market_analysis`, explanation quality target is long-form (8-12 sentences) with a fixed narrative order:
  - trend -> momentum -> structure -> liquidity/FVG -> volume -> volatility -> uncertainty -> conclusion
- For `4h + market_analysis`, explanation format is enforced as exactly 3 paragraphs (blank line between paragraphs) across providers.
- If explanation quality is below threshold, one targeted correction pass is triggered:
  - keep all fields unchanged
  - expand only `explanation`
  - return strict JSON only

## Payload Profiles (legacy vs minimal_v1/minimal_v2)
- `legacy` keeps the existing one-size payload shape.
- `minimal_v1` selects payload by analysis mode:
  - `trading_explainer`: keeps `prediction`, `slTpSource`, `ohlcvSeries`, `newsRisk/newsBlackout`, SMC, suggested levels, quality fields.
  - `market_analysis`: removes directional/setup fields (`prediction`, suggested levels, quality fields), keeps neutral analysis context.
- `minimal_v2` keeps the `minimal_v1` field split and additionally compacts heavy arrays before budget trimming:
  - `trading_explainer`: `ohlcvSeries<=80`, `historyContext.ev<=20`, `historyContext.lastBars.ohlc<=20`, keep only MTF run timeframe.
  - `market_analysis`: `ohlcvSeries<=60`, `historyContext.ev<=12`, `historyContext.lastBars.ohlc<=16`, keep only MTF run timeframe.
- Prompt scaffolding fields (`outputSchema`, `groundingRules`, `selectedIndicatorKeys`, `promptTimeframes`, `promptRunTimeframe`) are moved to system instructions in `minimal_v1`.
- `meta` is no longer attached to model payload in `minimal_v1`/`minimal_v2` (telemetry stays internal).

## Prompt Mode UX (Trading vs Analysis)
- Prompt templates now support `promptMode` (`trading_explainer` or `market_analysis`) as a compatible API field.
- Persisted source of truth remains `marketAnalysisUpdateEnabled`; mode is mapped both ways for backward compatibility.
- Server-side normalization rules:
  - `market_analysis` -> force `directionPreference=either`, `confidenceTargetPct=60`, `slTpSource=local`, `newsRiskMode=off`, `marketAnalysisUpdateEnabled=true`
  - `trading_explainer` -> `marketAnalysisUpdateEnabled=false`; trading fields remain as provided
- UI behavior in all prompt editors:
  - Select mode first.
  - Trading-only fields are hidden in analysis mode.
  - Switching to analysis resets hidden trading fields to defaults.

## 4h Market Analysis Neutral-Only
- If `marketAnalysisUpdateEnabled=true` and timeframe is `4h`, prediction normalization enforces:
  - `aiPrediction.signal = neutral`
  - `aiPrediction.confidence = 0`
  - `aiPrediction.expectedMovePct = 0`
- This keeps analysis mode informational and avoids directional trade output.

## Local Ollama Quickstart
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
# optional hard override if needed:
# AI_SIGNAL_ENGINE_OLLAMA=legacy
```

## Salad Cloud Ollama via Nginx Proxy (Dev + Prod)
Run a local OpenAI-compatible proxy that rewrites auth + path to Salad:

```bash
docker compose -f docker-compose.dev.yml up -d salad-proxy
curl http://localhost:8088/health
```

Production uses the same proxy config inside `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec -T api wget -qO- http://salad-proxy:8088/health
```

Set `SALAD_OPENAI_UPSTREAM_HOST` in your `.env` / `.env.prod` to the current Salad inference host from your container endpoint. The bundled proxy forwards `http://salad-proxy:8088/v1/chat/completions` to that host.

Admin values for uLiquid Desk:
- `aiProvider`: `ollama`
- `aiBaseUrl`: `http://salad-proxy:8088/v1`
- `aiModel`: `qwen3:8b`
- `aiApiKey`: `salad_cloud_user_...`

## Salad Cloud vLLM via Nginx Proxy (Dev + Prod)
Run a separate OpenAI-compatible proxy for vLLM:

```bash
# set SALAD_VLLM_UPSTREAM_HOST in .env first
docker compose -f docker-compose.dev.yml up -d salad-vllm-proxy
curl http://localhost:8089/health
```

Production uses the same optional proxy service inside `docker-compose.prod.yml`:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d salad-vllm-proxy
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api wget -qO- http://salad-vllm-proxy:8089/health
```

Set `SALAD_VLLM_UPSTREAM_HOST` in `.env` / `.env.prod` to the current Salad vLLM inference host. The bundled vLLM proxy forwards `http://salad-vllm-proxy:8089/v1/chat/completions` to `${SALAD_VLLM_UPSTREAM_CHAT_PATH:-/v1/chat/completions}` on that host.

Admin values for uLiquid Desk:
- `aiProvider`: `vllm`
- `aiBaseUrl`: `http://salad-vllm-proxy:8089/v1`
- `aiModel`: exact served vLLM model name, for example `Qwen/Qwen2.5-32B-Instruct`
- `aiApiKey`: `salad_cloud_user_...` for the Salad proxy; direct vLLM base URLs use the vLLM bearer key

For production internal HTTP targets, set `AI_ALLOW_PRIVATE_VLLM_BASE_URL=1`. For `agent_v1` tool calling, the vLLM container must be started with compatible tool-calling/parser settings.

Manual Salad runtime control (Admin):
- Endpoints:
  - `GET /admin/settings/api-keys/salad-runtime/status`
  - `POST /admin/settings/api-keys/salad-runtime/start`
  - `POST /admin/settings/api-keys/salad-runtime/stop`
- Runtime target is stored in `admin.apiKeys` under the active self-hosted profile (`ollama` or `vllm`):
  - `saladApiBaseUrl` (default `https://api.salad.com/api/public`)
  - `saladOrganization`
  - `saladProject`
  - `saladContainer`
- Uses the active self-hosted profile's stored AI key (`Salad-Api-Key`) for control calls.

Important:
- Do not use `http://localhost:8088/v1` in Admin when API runs in Docker.
- Use container DNS `salad-proxy` for API-container-to-proxy traffic.

## Safety Guarantees
- Output validation uses zod with strict constraints:
  - explanation max 1000 chars
  - tags max 5, allowlist-only
  - keyDrivers max 5, key paths must exist in `featureSnapshot`
  - disclaimer must be `"grounded_features_only"`
- On timeout, invalid JSON, schema mismatch, or rate-limit:
  - deterministic fallback text is used
  - no hard failure in prediction generation
- Logging includes:
  - `ai_call_ms`
  - `ai_cache_hit`
  - `ai_validation_failed`
  - `ai_fallback_used`
  - `ai_model`

## Indicator Pack v2
Predictions enrich `featureSnapshot.indicators` with deterministic OHLCV-based values:
- `rsi_14` (period 14)
- `macd` (`12/26/9`: line/signal/hist)
- `bb` (`20/2`: upper/mid/lower + `width_pct` + `pos`)
- `stochrsi` (`14/14/3/3`: `%K`, `%D`, `value`)
- `volume` (`lookback=100`: `vol_z`, `rel_vol`, `vol_ema_fast`, `vol_ema_slow`, `vol_trend`)
- `fvg` (3-candle imbalance summary):
  - open bullish / bearish counts
  - nearest bullish / bearish gap (zone + distance + age)
  - last created / last filled gap metadata
- `vumanchu` (VuManChu Cipher B core):
  - WaveTrend (`wt1/wt2/wtVwap`, cross/OB/OS state)
  - confirmed WT/RSI/Stoch divergences (regular + optional hidden)
  - core strategy markers (`buy/sell`, `buyDiv/sellDiv`, `goldNoBuyLong`) + signal ages
- `vwap`:
  - intraday timeframes (`5m`,`15m`,`1h`,`4h`): `session_utc` VWAP reset daily at **UTC 00:00**
  - daily (`1d`): `rolling_20` VWAP
- `adx` (`14`: `adx_14`, `plus_di_14`, `minus_di_14`)
- `atr_pct` (ATR(14) / close)
- `ohlcvSeries` (compact raw bar sequence used for AI reasoning):
  - `timeframe`
  - `format`: `["ts","open","high","low","close","volume"]`
  - `bars`: tuple rows with latest N candles (stored up to `AI_PROMPT_OHLCV_MAX_BARS`)
  - prompt runtime trims bars by prompt setting `ohlcvBars` (default `100`)

If candle history is insufficient, indicators are set to `null` and `featureSnapshot.riskFlags.dataGap=true`.

Session VWAP runtime tuning:
- `VWAP_SESSION_CACHE_TTL_MS` (default `120000`)
- `VWAP_SESSION_GAP_THRESHOLD` (default `0.03`)

FVG runtime tuning:
- `FVG_LOOKBACK_BARS` (default `300`)
- `FVG_FILL_RULE` (`overlap` default, optional `mid_touch`)

## Advanced Indicators Feature Pack v1
Predictions also include `featureSnapshot.advancedIndicators` (deterministic Node/TS port):
- `emas`: EMA(5/13/50/200/800), stack flags, distance/slope percentages
- `cloud`: EMA50 cloud (`stddev(close,100)/4`) with `price_pos`
- `levels`: daily OHLC + classic floor pivots (`pp/r1..s3`) + `m0..m5`, previous week/month highs/lows
- `ranges`: ADR(14), AWR(4), AMR(6), RD(15), RW(13) with high/low/50% bands and distance %
  - default mode mirrors Pine defaults (`DO/WO/MO=false`): Hi/Lo-anchored bands
  - optional open-anchor mode is supported internally
- `sessions`: static UTC sessions (London/NY/Tokyo/HK/Sydney/Frankfurt/EU Brinks/US Brinks)
- `sessions`: DST-aware UTC sessions aligned with TradersReality rules:
  - UK DST: last Sunday March -> last Sunday October (London/EU Brinks/Frankfurt)
  - US DST: second Sunday March -> first Sunday November (New York/US Brinks)
  - Sydney DST: first Sunday October -> first Sunday April
- `pvsra`: vector candle tier/color + transition patterns
- `smartMoneyConcepts`: structure + liquidity context inspired by LuxAlgo SMC logic:
  - internal/swing `BOS` / `CHoCH` state and break counts
  - equal highs/lows (`eqh` / `eql`) events
  - internal/swing order-block stacks and latest active block
  - FVG stack (bullish/bearish active counts + last threshold)
  - premium / discount / equilibrium zone levels

If history is too short for long EMAs (especially EMA800), fields are returned null-safe and
`featureSnapshot.advancedIndicators.dataGap=true`.
