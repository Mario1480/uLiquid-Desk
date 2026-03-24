import test from "node:test";
import assert from "node:assert/strict";
import {
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
    chatId: "-100999"
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
