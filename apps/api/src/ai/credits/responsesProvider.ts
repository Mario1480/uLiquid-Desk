import type { AiToolCall, ChatMessage, ChatToolDefinition } from "../provider.js";
import type { AiTokenUsage } from "./pricing.js";

type ResponseFormat = {
  type: "json_schema";
  json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
};

export type OpenAiResponsesResult = {
  content: string;
  toolCalls: AiToolCall[];
  usage: AiTokenUsage;
  model: string;
  serviceTier: string;
  responseId: string | null;
  requestId: string | null;
  finishReason: string | null;
};

function responseInput(messages: ChatMessage[]): { instructions?: string; input: unknown[] } {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      if (message.tool_call_id) input.push({ type: "function_call_output", call_id: message.tool_call_id, output: message.content });
      continue;
    }
    if (message.content.trim()) input.push({ role: message.role, content: message.content });
    for (const toolCall of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments
      });
    }
  }
  return { ...(instructions ? { instructions } : {}), input };
}

function responseTools(tools: ChatToolDefinition[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict ?? false
  }));
}

function textFormat(responseFormat: ResponseFormat | undefined): unknown {
  if (!responseFormat) return undefined;
  return {
    format: {
      type: "json_schema",
      name: responseFormat.json_schema.name,
      strict: responseFormat.json_schema.strict,
      schema: responseFormat.json_schema.schema
    }
  };
}

function parseUsage(payload: any): AiTokenUsage {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") throw new Error("ai_usage_missing");
  const integer = (value: unknown, required = false) => {
    if (value === undefined || value === null) {
      if (required) throw new Error("ai_usage_invalid");
      return 0n;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("ai_usage_invalid");
    return BigInt(parsed);
  };
  return {
    inputTokens: integer(usage.input_tokens, true),
    cachedInputTokens: integer(usage.input_tokens_details?.cached_tokens),
    cacheWriteTokens: integer(usage.input_tokens_details?.cache_write_tokens),
    outputTokens: integer(usage.output_tokens, true),
    reasoningTokens: integer(usage.output_tokens_details?.reasoning_tokens)
  };
}

function parseOutput(payload: any): { content: string; toolCalls: AiToolCall[] } {
  const content: string[] = [];
  const toolCalls: AiToolCall[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === "message") {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === "output_text" && typeof part.text === "string") content.push(part.text);
      }
    }
    if (item?.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
      toolCalls.push({ id: item.call_id, name: item.name, argumentsText: typeof item.arguments === "string" ? item.arguments : "{}" });
    }
  }
  return { content: content.join("\n").trim(), toolCalls };
}

export async function callOpenAiResponses(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  tools?: ChatToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  responseFormat?: ResponseFormat;
  signal: AbortSignal;
  safetyIdentifier?: string;
}): Promise<OpenAiResponsesResult> {
  const normalizedBaseUrl = params.baseUrl.replace(/\/$/, "");
  const mapped = responseInput(params.messages);
  const tools = responseTools(params.tools);
  const toolChoice = typeof params.toolChoice === "object"
    ? { type: "function", name: params.toolChoice.function.name }
    : params.toolChoice;
  const body: Record<string, unknown> = {
    model: params.model,
    service_tier: "default",
    store: false,
    truncation: "disabled",
    parallel_tool_calls: false,
    max_output_tokens: Math.max(1, Math.trunc(params.maxOutputTokens)),
    ...(params.reasoningEffort ? { reasoning: { ...(params.model.startsWith("gpt-5.6") ? { mode: "standard" } : {}), effort: params.reasoningEffort } } : {}),
    ...(params.safetyIdentifier ? { safety_identifier: params.safetyIdentifier } : {}),
    ...mapped,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(params.responseFormat ? { text: textFormat(params.responseFormat) } : {})
  };
  const response = await fetch(`${normalizedBaseUrl}/responses`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: params.signal
  });
  const requestId = response.headers.get("x-request-id");
  const payload = await response.json().catch(() => null) as any;
  if (!response.ok) {
    const error = new Error(String(payload?.error?.code ?? payload?.error?.message ?? `ai_http_${response.status}`));
    Object.assign(error, { status: response.status, requestId });
    throw error;
  }
  if (payload?.status !== "completed") {
    const error = new Error(String(payload?.incomplete_details?.reason ?? payload?.error?.code ?? "ai_response_incomplete"));
    Object.assign(error, { status: 503, requestId, responseId: payload?.id ?? null, usage: payload?.usage ?? null });
    throw error;
  }
  const output = parseOutput(payload);
  if (!output.content && output.toolCalls.length === 0) throw new Error("ai_empty_response");
  return {
    ...output,
    usage: parseUsage(payload),
    model: typeof payload.model === "string" ? payload.model : params.model,
    serviceTier: typeof payload.service_tier === "string" ? payload.service_tier : "default",
    responseId: typeof payload.id === "string" ? payload.id : null,
    requestId,
    finishReason: payload.status === "completed" ? "stop" : payload.status ?? null
  };
}
