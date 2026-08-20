import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { EconomicEvent } from "./contracts/economicCalendar.js";
import {
  blsReferencePeriodFromScheduledAt,
  curatedBlsFallbackEvents,
  curatedEconomicEvents
} from "./providers/official/curatedSchedules.js";
import { OfficialEconomicCalendarProvider, mergeEconomicScheduleAndReleases } from "./providers/official/OfficialEconomicCalendarProvider.js";
import { parseEurostatCalendarJson } from "./providers/official/eurostat.js";
import { parseIcsCalendar, zonedLocalTimeToUtc } from "./providers/official/ics.js";

const fixture = readFileSync(new URL("./fixtures/bls-calendar.ics", import.meta.url), "utf8");

test("official calendar fixture normalizes timezone and date-only precision", () => {
  const events = parseIcsCalendar(fixture);
  assert.equal(events.length, 2);
  assert.equal(events[0].start, "2026-08-12T12:30:00.000Z");
  assert.equal(events[0].timeConfidence, "exact");
  assert.equal(events[1].start, "2026-09-04T00:00:00.000Z");
  assert.equal(events[1].timeConfidence, "date_only");
  assert.equal(
    zonedLocalTimeToUtc({ year: 2026, month: 1, day: 14, hour: 8, minute: 30 }, "America/New_York").toISOString(),
    "2026-01-14T13:30:00.000Z"
  );
});

test("schedule and official release merge preserves provenance and revisions", () => {
  const event: EconomicEvent = {
    id: "cpi-1",
    provider: "official",
    sourceName: "BLS",
    sourceUrl: "https://www.bls.gov/cpi/",
    country: "US",
    currency: "USD",
    category: "inflation",
    title: "Consumer Price Index",
    scheduledAt: "2026-08-12T12:30:00.000Z",
    importance: "high",
    status: "scheduled",
    fetchedAt: "2026-08-02T00:00:00.000Z",
    timeConfidence: "exact"
  };
  const [merged] = mergeEconomicScheduleAndReleases([event], [{
    eventId: event.id,
    actual: 2.7,
    previous: 2.6,
    revision: 1,
    releasedAt: "2026-08-12T12:30:10.000Z"
  }]);
  assert.equal(merged.status, "revised");
  assert.equal(merged.actual, 2.7);
  assert.equal(merged.previous, 2.6);
  assert.equal(merged.releasedAt, "2026-08-12T12:30:10.000Z");
  assert.equal(merged.sourceUrl, event.sourceUrl);
});

test("curated official schedules cover the non-BLS U.S. MVP events", () => {
  const events = curatedEconomicEvents({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-11-01T00:00:00.000Z",
    fetchedAt: "2026-08-02T00:00:00.000Z"
  });
  const titles = new Set(events.map((event) => event.title));
  assert.ok(titles.has("FOMC Interest Rate Decision"));
  assert.ok(titles.has("Initial Jobless Claims"));
  assert.ok(titles.has("U.S. Gross Domestic Product (GDP)"));
  assert.ok(titles.has("U.S. Retail Sales"));
  assert.ok(titles.has("Personal Consumption Expenditures (PCE)"));
  assert.ok(titles.has("Core Personal Consumption Expenditures (Core PCE)"));
  assert.ok(events.every((event) => event.sourceUrl?.startsWith("https://")));
});

test("curated occurrence identity remains stable when a release time moves", () => {
  const previous = process.env.ECONOMIC_CURATED_SCHEDULE_JSON;
  const seed = {
    sourceKey: "test_release:2026-08",
    sourceName: "Official test source",
    sourceUrl: "https://example.test/schedule",
    country: "US",
    currency: "USD",
    category: "test",
    title: "Stable identity test",
    importance: "high",
    originalTimezone: "America/New_York",
    timeConfidence: "exact"
  };
  try {
    process.env.ECONOMIC_CURATED_SCHEDULE_JSON = JSON.stringify([{ ...seed, scheduledAt: "2026-08-10T12:30:00.000Z" }]);
    const first = curatedEconomicEvents({ from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" })
      .find((event) => event.title === seed.title);
    process.env.ECONOMIC_CURATED_SCHEDULE_JSON = JSON.stringify([{ ...seed, scheduledAt: "2026-08-10T13:30:00.000Z" }]);
    const moved = curatedEconomicEvents({ from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" })
      .find((event) => event.title === seed.title);
    assert.ok(first);
    assert.ok(moved);
    assert.equal(moved.id, first.id);
    assert.notEqual(moved.scheduledAt, first.scheduledAt);
  } finally {
    if (previous === undefined) delete process.env.ECONOMIC_CURATED_SCHEDULE_JSON;
    else process.env.ECONOMIC_CURATED_SCHEDULE_JSON = previous;
  }
});

test("Eurostat release calendar maps high, medium and low events with stable record identities", () => {
  const body = JSON.stringify([
    { recordid: "hicp-1", start: "2026-08-19T11:00Z", period: "July 2026", title: "Inflation (HICP)", datasetCodes: "prc_hicp_aind" },
    { recordid: "gdp-1", start: "2026-08-14T11:00Z", period: "Q2/2026", title: "Flash estimate GDP and employment - EU and euro area", datasetCodes: "namq_10_gdp" },
    { recordid: "industry-1", start: "2026-08-13T11:00Z", title: "Industrial production" },
    { recordid: "rates-1", start: "2026-08-13T11:00Z", title: "Interest rates (3 months)" }
  ]);
  const events = parseEurostatCalendarJson(body, "2026-08-02T00:00:00.000Z");
  assert.equal(events.length, 4);
  assert.deepEqual(new Set(events.map((event) => event.importance)), new Set(["high", "medium", "low"]));
  assert.equal(events.find((event) => event.title === "Industrial production")?.category, "production");
  assert.equal(events.find((event) => event.title === "Interest rates (3 months)")?.category, "rates");
  assert.ok(events.every((event) => event.sourceName === "Eurostat" && event.currency === "EUR"));
  assert.equal(
    parseEurostatCalendarJson(body, "2026-08-03T00:00:00.000Z").find((event) => event.category === "inflation")?.id,
    events.find((event) => event.category === "inflation")?.id
  );
});

test("curated BLS outage fallback preserves the same stable period identity", () => {
  const events = curatedBlsFallbackEvents({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-11-01T00:00:00.000Z",
    fetchedAt: "2026-08-02T00:00:00.000Z"
  });
  assert.equal(blsReferencePeriodFromScheduledAt("2026-08-12T12:30:00.000Z"), "2026-07");
  assert.deepEqual(new Set(events.map((event) => event.title)), new Set([
    "Consumer Price Index (CPI)",
    "Core Consumer Price Index (Core CPI)",
    "Producer Price Index (PPI)",
    "Nonfarm Payrolls",
    "Unemployment Rate"
  ]));
  assert.ok(events.every((event) => event.period && event.sourceName === "U.S. Bureau of Labor Statistics"));
});

test("curated BLS fallback keeps official calendar healthy when Eurostat is available", async () => {
  const provider = new OfficialEconomicCalendarProvider(async ({ url }) => {
    if (url.includes("bls.gov")) throw new Error("rss_http_403");
    return {
      body: JSON.stringify([{ recordid: "eu-1", start: "2026-09-01T09:00Z", title: "Industrial production" }]),
      finalUrl: url,
      contentType: "application/json"
    };
  });
  const result = await provider.fetchEvents({
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-11-01T00:00:00.000Z"
  });
  const health = await provider.health();
  assert.equal(result.degraded, false);
  assert.equal(health.state, "healthy");
  assert.match(health.message ?? "", /BLS curated fallback active/);
  assert.ok(result.warnings.some((warning) => warning.code === "official_bls_schedule_unavailable"));
});
