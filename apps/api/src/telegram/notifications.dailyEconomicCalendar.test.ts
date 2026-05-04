import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketAnalysisUpdateTelegramText,
  buildTradablePredictionTelegramText,
  filterEconomicEventsByLocalDate,
  formatTelegramTagsLine,
  resolveTelegramSystemDestination,
  resolveTelegramUserDestination
} from "./notifications.js";

test("filterEconomicEventsByLocalDate keeps only events in target local date", () => {
  const events = [
    {
      id: "1",
      sourceId: "1",
      ts: "2026-03-01T23:30:00.000Z",
      country: "US",
      currency: "USD",
      title: "Event A",
      impact: "high",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    },
    {
      id: "2",
      sourceId: "2",
      ts: "2026-03-02T08:00:00.000Z",
      country: "DE",
      currency: "EUR",
      title: "Event B",
      impact: "medium",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    },
    {
      id: "3",
      sourceId: "3",
      ts: "2026-03-02T23:30:00.000Z",
      country: "JP",
      currency: "JPY",
      title: "Event C",
      impact: "high",
      forecast: null,
      previous: null,
      actual: null,
      source: "fmp"
    }
  ];

  const filtered = filterEconomicEventsByLocalDate({
    events,
    timezone: "Europe/Berlin",
    localDate: "2026-03-02"
  });

  assert.deepEqual(filtered.map((event) => event.id), ["1", "2"]);
});

test("formatTelegramTagsLine returns null for empty input", () => {
  assert.equal(formatTelegramTagsLine(undefined), null);
  assert.equal(formatTelegramTagsLine([]), null);
  assert.equal(formatTelegramTagsLine(["", "   "]), null);
});

test("formatTelegramTagsLine trims and deduplicates tags", () => {
  const line = formatTelegramTagsLine([" news_risk ", "range_bound", "news_risk", ""]);
  assert.equal(line, "Tags: news_risk, range_bound");
});

test("buildTradablePredictionTelegramText uses German labels when selected", () => {
  const text = buildTradablePredictionTelegramText({
    userId: "user_1",
    exchange: "bitget",
    exchangeAccountLabel: "Main",
    symbol: "BTCUSDT",
    marketType: "perp",
    timeframe: "15m",
    signal: "up",
    confidence: 0.72,
    confidenceTargetPct: 60,
    expectedMovePct: 1.23,
    predictionId: "pred_1",
    explanation: "Momentum bleibt positiv.",
    source: "auto",
    signalSource: "ai",
    responseLanguage: "de",
    aiPromptTemplateName: "Default",
    tags: ["trend_up"]
  });

  assert.match(text, /SIGNAL ALERT/);
  assert.match(text, /Quelle: ai/);
  assert.match(text, /Strategie: Default/);
  assert.match(text, /Konfidenz: 72\.0% \(Ziel 60%\)/);
  assert.match(text, /Erwartete Bewegung: 1\.23%/);
  assert.match(text, /Begründung: Momentum bleibt positiv\./);
});

test("buildMarketAnalysisUpdateTelegramText uses German labels when selected", () => {
  const text = buildMarketAnalysisUpdateTelegramText({
    userId: "user_1",
    exchange: "bitget",
    exchangeAccountLabel: "Main",
    symbol: "ETHUSDT",
    marketType: "perp",
    timeframe: "1h",
    signal: "neutral",
    confidence: 0.4,
    expectedMovePct: 0.5,
    predictionId: "pred_2",
    explanation: "Seitwaertsphase.",
    source: "auto",
    signalSource: "ai",
    responseLanguage: "de",
    aiPromptTemplateName: "Default"
  });

  assert.match(text, /MARKTANALYSE UPDATE/);
  assert.match(text, /Quelle: ai/);
  assert.match(text, /Strategie: Default/);
  assert.match(text, /Analyse: Seitwaertsphase\./);
});

test("resolveTelegramUserDestination does not fall back to admin config chat", () => {
  const resolved = resolveTelegramUserDestination({
    envToken: null,
    envChatId: null,
    configToken: "bot-token",
    userChatId: null
  });
  assert.deepEqual(resolved, {
    botToken: "bot-token",
    chatId: null
  });
});

test("resolveTelegramUserDestination keeps env override behavior when fully configured", () => {
  const resolved = resolveTelegramUserDestination({
    envToken: "env-token",
    envChatId: "-100999",
    configToken: "db-token",
    userChatId: null
  });
  assert.deepEqual(resolved, {
    botToken: "env-token",
    chatId: null
  });
});

test("resolveTelegramUserDestination keeps personal user chat even when env admin chat exists", () => {
  const resolved = resolveTelegramUserDestination({
    envToken: "env-token",
    envChatId: "-100999",
    configToken: "db-token",
    userChatId: "-100555"
  });
  assert.deepEqual(resolved, {
    botToken: "env-token",
    chatId: "-100555"
  });
});

test("resolveTelegramSystemDestination uses configured admin chat when no env override exists", () => {
  const resolved = resolveTelegramSystemDestination({
    envToken: null,
    envChatId: null,
    configToken: "db-token",
    configChatId: "-100123"
  });
  assert.deepEqual(resolved, {
    botToken: "db-token",
    chatId: "-100123"
  });
});
