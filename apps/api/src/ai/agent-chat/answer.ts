import { agentAnswerEnvelopeSchema, agentSourceRefSchema, agentUiBlockSchema } from "./schemas.js";
import type { AgentSourceRef, AgentUiBlock } from "./contracts.js";

export type ParsedAgentAnswer = {
  content: string;
  blocks: AgentUiBlock[];
  citations: AgentSourceRef[];
};

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const METRIC_IGNORED_KEYS = new Set([
  "context",
  "detected",
  "direction",
  "high",
  "interval",
  "low",
  "note",
  "notes",
  "open",
  "observed_at",
  "observedAt"
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function humanize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatMetricValue(path: string[], value: unknown, units?: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return boundedText(value, 160);
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const key = path.join("_").toLowerCase();
  if (key.includes("funding_rate") && Math.abs(value) < 1) {
    return `${(value * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
  }
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 1 ? 8 : 2
  }).format(value);
  const suffix = boundedText(units, 24);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function collectMetricItems(value: unknown): Array<{ label: string; value: string; tone?: "neutral" | "positive" | "warning" | "critical" }> {
  const items: Array<{ label: string; value: string; tone?: "neutral" | "positive" | "warning" | "critical" }> = [];
  const seen = new Set<string>();

  const add = (path: string[], raw: unknown, units?: unknown) => {
    if (items.length >= 12 || path.length === 0) return;
    const formatted = formatMetricValue(path, raw, units);
    if (!formatted) return;
    const label = humanize(path.join(" ")).slice(0, 100);
    const key = `${label}:${formatted}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ label, value: formatted, tone: "neutral" });
  };

  const visit = (current: unknown, path: string[], depth: number) => {
    if (items.length >= 12 || depth > 4) return;
    if (Array.isArray(current)) {
      const primitives = current.filter((entry) => ["string", "number", "boolean"].includes(typeof entry));
      if (primitives.length === current.length && primitives.length > 0) {
        add(path, primitives.join(" · "));
        return;
      }
      current.slice(0, 6).forEach((entry, index) => {
        const row = toRecord(entry);
        const interval = boundedText(row?.interval, 16);
        visit(entry, [...path, interval ?? String(index + 1)], depth + 1);
      });
      return;
    }
    const record = toRecord(current);
    if (record) {
      if (["string", "number", "boolean"].includes(typeof record.value)) {
        add(path, record.value, record.units);
        return;
      }
      for (const [key, nested] of Object.entries(record)) {
        if (METRIC_IGNORED_KEYS.has(key)) continue;
        visit(nested, [...path, key], depth + 1);
        if (items.length >= 12) break;
      }
      return;
    }
    add(path, current);
  };

  visit(value, [], 0);
  return items;
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" | "critical" {
  const level = String(value ?? "").trim().toLowerCase();
  return RISK_LEVELS.has(level) ? level as "low" | "medium" | "high" | "critical" : "medium";
}

function normalizeSourceRef(value: unknown): AgentSourceRef | null {
  const parsed = agentSourceRefSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeLegacyBlock(value: unknown): AgentUiBlock | null {
  const block = toRecord(value);
  const type = boundedText(block?.type, 64);
  if (!block || !type) return null;
  const title = boundedText(block.title, 120) ?? undefined;

  if (type === "summary") {
    const text = boundedText(block.text ?? block.content, 4_000);
    return text ? { type: "summary", ...(title ? { title } : {}), text } : null;
  }
  if (type === "key_metrics") {
    const canonicalItems = Array.isArray(block.items) ? block.items : null;
    if (canonicalItems) {
      const parsed = agentUiBlockSchema.safeParse({ type, title, items: canonicalItems });
      if (parsed.success && parsed.data.type === "key_metrics") return parsed.data;
    }
    const items = collectMetricItems(block.content);
    return items.length > 0 ? { type: "key_metrics", ...(title ? { title } : {}), items } : null;
  }
  if (type === "risk_findings") {
    const riskLevel = normalizeRiskLevel(block.riskLevel ?? block.severity);
    if (Array.isArray(block.items)) {
      const parsed = agentUiBlockSchema.safeParse({ type, title, riskLevel, items: block.items });
      if (parsed.success && parsed.data.type === "risk_findings") return parsed.data;
    }
    const findings = Array.isArray(block.content) ? block.content : [];
    const items = findings.flatMap((finding, index) => {
      const detail = boundedText(finding, 600);
      if (!detail) return [];
      return [{
        title: `#${index + 1}`,
        detail
      }];
    }).slice(0, 12);
    return items.length > 0 ? { type: "risk_findings", ...(title ? { title } : {}), riskLevel, items } : null;
  }
  if (type === "scenario_table") {
    const content = toRecord(block.content);
    const columns = Array.isArray(block.columns) ? block.columns : content?.columns;
    const rows = Array.isArray(block.rows) ? block.rows : content?.rows;
    const parsed = agentUiBlockSchema.safeParse({ type, title, columns, rows });
    return parsed.success && parsed.data.type === "scenario_table" ? parsed.data : null;
  }
  if (type === "prediction_comparison") {
    const content = toRecord(block.content);
    const parsed = agentUiBlockSchema.safeParse({
      type,
      title,
      prediction: block.prediction ?? content?.prediction,
      position: block.position ?? content?.position,
      divergence: block.divergence ?? content?.divergence
    });
    return parsed.success && parsed.data.type === "prediction_comparison" ? parsed.data : null;
  }
  if (type === "source_list") {
    const rawSources = Array.isArray(block.sources) ? block.sources : Array.isArray(block.content) ? block.content : [];
    const sources = rawSources.flatMap((source) => {
      const normalized = normalizeSourceRef(source);
      return normalized ? [normalized] : [];
    }).slice(0, 20);
    return sources.length > 0 ? { type: "source_list", ...(title ? { title } : {}), sources } : null;
  }
  return null;
}

function removeDuplicateSummary(content: string, blocks: AgentUiBlock[]): AgentUiBlock[] {
  const normalizedContent = content.trim().replace(/\s+/g, " ");
  return blocks.filter((block) => block.type !== "summary" || block.text.trim().replace(/\s+/g, " ") !== normalizedContent);
}

export function parseAgentAnswer(rawContent: string, locale: "de" | "en" = "en"): ParsedAgentAnswer {
  const text = rawContent.trim();
  if (!text) throw new Error("agent_chat_empty_answer");

  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(text));
  } catch {
    return { content: text.slice(0, 12_000), blocks: [], citations: [] };
  }

  const canonical = agentAnswerEnvelopeSchema.safeParse(json);
  if (canonical.success) {
    return {
      ...canonical.data,
      blocks: removeDuplicateSummary(canonical.data.content, canonical.data.blocks)
    };
  }

  const envelope = toRecord(json);
  if (!envelope) {
    return {
      content: locale === "de" ? "Die strukturierte Analyse konnte nicht dargestellt werden." : "The structured analysis could not be displayed.",
      blocks: [],
      citations: []
    };
  }

  const blocks = (Array.isArray(envelope.blocks) ? envelope.blocks : [])
    .flatMap((block) => {
      const normalized = normalizeLegacyBlock(block);
      return normalized ? [normalized] : [];
    })
    .slice(0, 12);
  const summary = blocks.find((block): block is Extract<AgentUiBlock, { type: "summary" }> => block.type === "summary");
  const content = boundedText(envelope.content ?? envelope.answer ?? envelope.message, 12_000)
    ?? summary?.text
    ?? (locale === "de" ? "Die Analyse ist abgeschlossen." : "The analysis is complete.");
  const citations = (Array.isArray(envelope.citations) ? envelope.citations : [])
    .flatMap((citation) => {
      const normalized = normalizeSourceRef(citation);
      return normalized ? [normalized] : [];
    })
    .slice(0, 20);
  return { content, blocks: removeDuplicateSummary(content, blocks), citations };
}

export function normalizeStoredAgentMessages<T extends { role?: unknown; content?: unknown; blocks?: unknown }>(messages: T[]): T[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string") return message;
    if (Array.isArray(message.blocks) && message.blocks.length > 0) return message;
    const parsed = parseAgentAnswer(message.content);
    if (parsed.content === message.content && parsed.blocks.length === 0) return message;
    return { ...message, content: parsed.content, blocks: parsed.blocks } as T;
  });
}
