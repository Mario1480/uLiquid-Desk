import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import AgentMessageBlocks from "../../components/agent-chat/AgentMessageBlocks.js";
import type { AgentUiBlock } from "./contracts.js";

const messages = {
  agentChat: {
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
    states: { degraded: "degraded", stale: "stale" }
  }
};

test("renders normalized metrics and risks as compact UI blocks instead of JSON", () => {
  const blocks: AgentUiBlock[] = [
    {
      type: "key_metrics",
      items: [
        { label: "Symbol", value: "BTCUSDT" },
        { label: "Funding rate", value: "0.0013%" }
      ]
    },
    {
      type: "risk_findings",
      riskLevel: "medium",
      items: [{ title: "#1", detail: "Positive funding creates an ongoing cost for long positions." }]
    }
  ];
  const originalConsoleError = console.error;
  let html = "";
  try {
    // next-intl reports its expected server-render fallback outside a Next request.
    console.error = () => undefined;
    html = renderToStaticMarkup(createElement(
      NextIntlClientProvider,
      { locale: "en", messages, children: createElement(AgentMessageBlocks, { blocks }) }
    ));
  } finally {
    console.error = originalConsoleError;
  }
  assert.match(html, /Key metrics/);
  assert.match(html, /BTCUSDT/);
  assert.match(html, /0\.0013%/);
  assert.match(html, /Risk findings/);
  assert.match(html, /Medium/);
  assert.doesNotMatch(html, /&quot;blocks&quot;/);
});
