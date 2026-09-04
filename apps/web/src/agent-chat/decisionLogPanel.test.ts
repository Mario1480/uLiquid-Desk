import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AgentActivityPanel from "../../components/agent-chat/AgentActivityPanel.js";
import type { AgentDecisionLog } from "./contracts.js";

const messages = {
  agentChat: {
    actions: { close: "Close" },
    activity: { internal: "Internal" },
    blocks: {
      summary: "Summary",
      keyMetrics: "Key metrics",
      riskFindings: "Risk findings",
      scenarios: "Scenarios",
      comparison: "Prediction comparison",
      sourceList: "Sources",
      prediction: "Prediction",
      position: "Position",
      divergence: "Divergence",
      riskLevels: { low: "Low", medium: "Medium", high: "High", critical: "Critical" }
    },
    states: { degraded: "degraded", stale: "stale" },
    decisionLog: {
      title: "Decision Log",
      recentRuns: "Recent runs",
      loading: "Loading decision logs...",
      empty: "No decision logs yet.",
      noExecution: "No trading action permitted",
      recommendation: "Recommendation",
      noRecommendation: "No recommendation is available for this run.",
      dataQuality: "Data quality",
      evidence: "Evidence",
      noEvidence: "No validated evidence is available.",
      technicalActivity: "Technical activity",
      quality: { fresh: "Fresh", stale: "Stale", degraded: "Degraded", unavailable: "Unavailable" }
    }
  }
};

function render(logs: AgentDecisionLog[], loading: boolean) {
  const originalConsoleError = console.error;
  try {
    console.error = () => undefined;
    return renderToStaticMarkup(createElement(
      NextIntlClientProvider,
      { locale: "en", messages, children: createElement(AgentActivityPanel, { logs, loading }) }
    ));
  } finally {
    console.error = originalConsoleError;
  }
}

test("decision log panel exposes loading and empty states", () => {
  assert.match(render([], true), /Loading decision logs/);
  assert.match(render([], false), /No decision logs yet/);
});

test("decision log panel renders failed unsupported-provider runs without a fabricated recommendation", () => {
  const failed: AgentDecisionLog = {
    runId: "run-failed",
    state: "failed",
    createdAt: "2026-09-04T12:00:00.000Z",
    completedAt: "2026-09-04T12:00:01.000Z",
    profile: { key: "market_analyst", name: "Market Analyst", version: 2 },
    context: { symbol: "BTCUSDT", marketType: "perp", requestedVenue: "bingx" },
    recommendation: null,
    evidence: [],
    dataQuality: { state: "unavailable", reasonCodes: ["agent_chat_venue_unsupported"] },
    modelClass: null,
    totalLatencyMs: 1000,
    permission: { readOnly: true, execution: "not_permitted" },
    technicalActivity: [{ id: "tool-1", skillId: "market.get_open_interest", status: "failed", venue: "bingx", durationMs: 20, errorCode: "agent_chat_venue_unsupported" }],
    legacyAssociation: false
  };
  const html = render([failed], false);
  assert.match(html, /No trading action permitted/);
  assert.match(html, /No recommendation is available/);
  assert.match(html, /Unavailable/);
  assert.match(html, /agent_chat_venue_unsupported/);
  assert.doesNotMatch(html, /Buy|Sell|Long|Short/);
});

test("decision log panel renders validated recommendation metric blocks", () => {
  const completed: AgentDecisionLog = {
    runId: "run-completed",
    state: "completed",
    createdAt: "2026-09-04T12:00:00.000Z",
    completedAt: "2026-09-04T12:00:01.000Z",
    profile: { key: "market_analyst", name: "Market Analyst", version: 2 },
    context: { symbol: "BTCUSDT", marketType: "perp", requestedVenue: "binance" },
    recommendation: { messageId: "message-1", content: "Observe funding.", blocks: [{ type: "key_metrics", items: [{ label: "Funding", value: "1.0 bps" }] }] },
    evidence: [],
    dataQuality: { state: "fresh", reasonCodes: [] },
    modelClass: "standard",
    totalLatencyMs: 1000,
    permission: { readOnly: true, execution: "not_permitted" },
    technicalActivity: [],
    legacyAssociation: false
  };
  const html = render([completed], false);
  assert.match(html, /Funding/);
  assert.match(html, /1\.0 bps/);
});
