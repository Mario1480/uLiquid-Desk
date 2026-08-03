import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredAgentMessages, parseAgentAnswer } from "./answer.js";

const liveShape = JSON.stringify({
  blocks: [
    { type: "summary", content: "BTCUSDT perpetual analysis with funding and open interest." },
    {
      type: "key_metrics",
      content: {
        symbol: "BTCUSDT",
        market_type: "perp",
        timeframes: [
          { interval: "1h", latest_candle: { open: 64_490, high: 64_571, low: 64_463, close: 64_501 } },
          { interval: "4h", latest_candle_close: 63_000 }
        ],
        funding_rate: { value: 0.0000125, direction: "positive" },
        open_interest: { value: 35_485.93134, units: "contracts" }
      }
    },
    {
      type: "risk_findings",
      content: [
        "Positive funding creates an ongoing cost for long positions.",
        "Elevated open interest can amplify liquidation moves."
      ],
      detected: true
    },
    { type: "source_list", content: [{ tool: "market.get_ohlcv", venue: "auto" }] }
  ],
  citations: [{ toolId: "market.get_ohlcv", note: "Unverified model citation" }]
});

test("normalizes the live alternate block shape into renderable UI blocks", () => {
  const parsed = parseAgentAnswer(liveShape);
  assert.equal(parsed.content, "BTCUSDT perpetual analysis with funding and open interest.");
  assert.deepEqual(parsed.blocks.map((block) => block.type), ["key_metrics", "risk_findings"]);
  const metrics = parsed.blocks[0];
  assert.equal(metrics.type, "key_metrics");
  if (metrics.type === "key_metrics") {
    assert.equal(metrics.items.some((item) => item.label === "Symbol" && item.value === "BTCUSDT"), true);
    assert.equal(metrics.items.some((item) => item.value === "0.0013%"), true);
  }
  assert.deepEqual(parsed.citations, []);
});

test("keeps canonical answers canonical and removes duplicate summaries", () => {
  const parsed = parseAgentAnswer(JSON.stringify({
    content: "Market structure remains constructive.",
    blocks: [
      { type: "summary", text: "Market structure remains constructive." },
      { type: "key_metrics", items: [{ label: "Price", value: "64,501" }] }
    ],
    citations: []
  }));
  assert.deepEqual(parsed.blocks.map((block) => block.type), ["key_metrics"]);
});

test("rehydrates previously stored raw JSON without mutating plain messages", () => {
  const rows = normalizeStoredAgentMessages([
    { id: "assistant", role: "assistant", content: liveShape, blocks: null },
    { id: "user", role: "user", content: "Analyze BTC", blocks: null }
  ]);
  assert.equal(rows[0].content, "BTCUSDT perpetual analysis with funding and open interest.");
  assert.equal(Array.isArray(rows[0].blocks), true);
  assert.equal(rows[1].content, "Analyze BTC");
});

test("repairs a missing risk detail key and normalizes unsupported metric tones", () => {
  const malformed = '{"content":"BTC ist bärisch bis neutral.","blocks":['
    + '{"type":"key_metrics","title":"BTC Daily","items":['
    + '{"label":"Preis","value":"62.726 USD","tone":"negative"}]},'
    + '{"type":"scenario_table","title":"Szenarien","columns":["Szenario","Lesart"],"rows":[["Bärisch","Unter SMA20"]]},'
    + '{"type":"risk_findings","title":"Risiko","riskLevel":"high","items":['
    + '{"title":"Volatilität","detail":"ATR ist erhöht."},'
    + '{"title":"Kein Trendwechsel","RSI bleibt unter 50."}]},'
    + '{"type":"source_list","title":"Quellen","sources":["Unverified source text"]}'
    + '],"citations":[]}';

  const parsed = parseAgentAnswer(malformed, "de");

  assert.equal(parsed.content, "BTC ist bärisch bis neutral.");
  assert.deepEqual(parsed.blocks.map((block) => block.type), ["key_metrics", "scenario_table", "risk_findings"]);
  const metrics = parsed.blocks[0];
  assert.equal(metrics.type, "key_metrics");
  if (metrics.type === "key_metrics") assert.equal(metrics.items[0]?.tone, "warning");
  const risks = parsed.blocks[2];
  assert.equal(risks.type, "risk_findings");
  if (risks.type === "risk_findings") assert.equal(risks.items[1]?.detail, "RSI bleibt unter 50.");
  assert.deepEqual(parsed.citations, []);
});
