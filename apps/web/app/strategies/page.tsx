"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import { AppIcon } from "../components/AppIcon";

type StrategyIndicatorOption = {
  key: string;
  label: string;
  group: string;
  description: string;
};

type PromptMode = "trading_explainer" | "market_analysis";

type StrategyPromptTemplate = {
  id: string;
  name: string;
  promptText: string;
  indicatorKeys: string[];
  ohlcvBars: number;
  timeframes: StrategyTimeframe[];
  runTimeframe: StrategyTimeframe | null;
  timeframe: StrategyTimeframe | null;
  directionPreference: "long" | "short" | "either";
  confidenceTargetPct: number;
  slTpSource: "local" | "ai" | "hybrid";
  newsRiskMode: "off" | "block";
  promptMode: PromptMode;
  marketAnalysisUpdateEnabled?: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type StrategyPromptGenerationMeta = {
  mode: "ai" | "fallback";
  model: string;
};

type StrategyOwnPromptsResponse = {
  items: StrategyPromptTemplate[];
  availableIndicators: StrategyIndicatorOption[];
  strategyFeatureEnabled: boolean;
  updatedAt: string | null;
};

type StrategyChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type StrategyPromptBuilderChatResponse = {
  assistantMessage: string;
  toolCall: {
    name: "create_template_draft" | "update_template_draft";
    arguments: { draft: PredictionTemplateDraft };
  };
  proposedDraft: PredictionTemplateDraft;
  diff: PredictionTemplateDraftChange[];
  validation: PredictionTemplateDraftValidation;
  readyForPreview: boolean;
  generationMeta: StrategyPromptGenerationMeta;
  safety: PredictionBuilderSafety;
};

type PredictionTemplateDraft = {
  schemaVersion: "prediction-template-draft/v1";
  draftId: string;
  revision: number;
  name: string;
  analysisGoal: string;
  promptMode: PromptMode;
  timeframes: StrategyTimeframe[];
  runTimeframe: StrategyTimeframe | null;
  horizon: { value: number; unit: "minutes" | "hours" | "days" };
  indicatorKeys: string[];
  directionRules: {
    preference: "long" | "short" | "either";
    long: string;
    short: string;
    noTrade: string;
  };
  priceLevels: {
    entry: number | null;
    invalidation: number | null;
    targets: number[];
  };
  confidenceTargetPct: number;
  ohlcvBars: number;
  slTpSource: "local" | "ai" | "hybrid";
  newsRiskMode: "off" | "block";
};

type PredictionTemplateDraftChange = { path: string; before: unknown; after: unknown };
type PredictionTemplateDraftValidation = {
  valid: boolean;
  issues: Array<{ path: string; code: string; severity: "error" | "warning"; message: string }>;
};
type PredictionBuilderSafety = {
  allowedTools: string[];
  sideEffects: {
    predictionCreated: false;
    orderCreated: false;
    positionModified: false;
    copierConfigured: false;
    copierActivated: false;
  };
};

type PredictionDraftProposal = {
  draft: PredictionTemplateDraft;
  diff: PredictionTemplateDraftChange[];
  validation: PredictionTemplateDraftValidation;
  toolName: "create_template_draft" | "update_template_draft";
};

const STRATEGY_TIMEFRAME_OPTIONS = ["5m", "15m", "1h", "4h", "1d"] as const;
type StrategyTimeframe = (typeof STRATEGY_TIMEFRAME_OPTIONS)[number];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.message} (HTTP ${e.status})`;
  if (e && typeof e === "object" && "message" in e) return String((e as { message?: unknown }).message ?? e);
  return String(e);
}

function makeStrategyChatMessageId(): string {
  return `strategy_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimStrategyChatText(value: string, maxChars = 1200): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd();
}

export default function StrategiesPage() {
  const tMain = useTranslations("system.settingsMain");
  const tCommon = useTranslations("settings.common");
  const locale = useLocale() as AppLocale;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [strategyFeatureEnabled, setStrategyFeatureEnabled] = useState(false);
  const [strategyPrompts, setStrategyPrompts] = useState<StrategyPromptTemplate[]>([]);
  const [strategyIndicators, setStrategyIndicators] = useState<StrategyIndicatorOption[]>([]);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyGenerating, setStrategyGenerating] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyDeletingId, setStrategyDeletingId] = useState<string | null>(null);
  const [strategyEditingId, setStrategyEditingId] = useState<string | null>(null);
  const [strategyName, setStrategyName] = useState("");
  const [strategyDescription, setStrategyDescription] = useState("");
  const [strategyIndicatorKeys, setStrategyIndicatorKeys] = useState<string[]>([]);
  const [strategyTimeframes, setStrategyTimeframes] = useState<StrategyTimeframe[]>([]);
  const [strategyRunTimeframe, setStrategyRunTimeframe] = useState<"" | StrategyTimeframe>("");
  const [strategyPromptMode, setStrategyPromptMode] = useState<PromptMode>("trading_explainer");
  const [strategyDirectionPreference, setStrategyDirectionPreference] = useState<"long" | "short" | "either">("either");
  const [strategyConfidenceTargetPct, setStrategyConfidenceTargetPct] = useState("60");
  const [strategySlTpSource, setStrategySlTpSource] = useState<"local" | "ai" | "hybrid">("local");
  const [strategyNewsRiskMode, setStrategyNewsRiskMode] = useState<"off" | "block">("off");
  const [strategyOhlcvBars, setStrategyOhlcvBars] = useState("100");
  const [strategyPreviewOpen, setStrategyPreviewOpen] = useState(false);
  const [strategyPreviewPromptText, setStrategyPreviewPromptText] = useState("");
  const [strategyPreviewMeta, setStrategyPreviewMeta] = useState<StrategyPromptGenerationMeta | null>(null);
  const [strategyLastSavedPromptText, setStrategyLastSavedPromptText] = useState("");
  const [strategyLastSavedMeta, setStrategyLastSavedMeta] = useState<StrategyPromptGenerationMeta | null>(null);
  const [strategyChatMessages, setStrategyChatMessages] = useState<StrategyChatMessage[]>([]);
  const [strategyChatInput, setStrategyChatInput] = useState("");
  const [strategyChatSending, setStrategyChatSending] = useState(false);
  const [strategyChatMeta, setStrategyChatMeta] = useState<StrategyPromptGenerationMeta | null>(null);
  const [strategyDraftId] = useState(() => `prediction_draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const [strategyDraftRevision, setStrategyDraftRevision] = useState(1);
  const [strategyHorizonValue, setStrategyHorizonValue] = useState("4");
  const [strategyHorizonUnit, setStrategyHorizonUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [strategyLongRule, setStrategyLongRule] = useState("");
  const [strategyShortRule, setStrategyShortRule] = useState("");
  const [strategyNoTradeRule, setStrategyNoTradeRule] = useState("");
  const [strategyEntryLevel, setStrategyEntryLevel] = useState("");
  const [strategyInvalidationLevel, setStrategyInvalidationLevel] = useState("");
  const [strategyTargetLevels, setStrategyTargetLevels] = useState("");
  const [strategyDraftProposal, setStrategyDraftProposal] = useState<PredictionDraftProposal | null>(null);
  const [strategyDraftValidation, setStrategyDraftValidation] = useState<PredictionTemplateDraftValidation | null>(null);
  const [strategyDraftHistory, setStrategyDraftHistory] = useState<PredictionTemplateDraft[]>([]);
  const [strategyPreviewSafety, setStrategyPreviewSafety] = useState<PredictionBuilderSafety | null>(null);

  function toggleStrategyIndicator(key: string) {
    setStrategyIndicatorKeys((prev) =>
      prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]
    );
  }

  function toggleStrategyTimeframe(value: StrategyTimeframe) {
    setStrategyTimeframes((prev) => {
      if (prev.includes(value)) {
        const next = prev.filter((entry) => entry !== value);
        if (!next.includes(strategyRunTimeframe as StrategyTimeframe)) {
          setStrategyRunTimeframe(next[0] ?? "");
        }
        return next;
      }
      if (prev.length >= 4) return prev;
      const next = [...prev, value];
      if (!strategyRunTimeframe) setStrategyRunTimeframe(value);
      return next;
    });
  }

  function handleStrategyPromptModeChange(nextMode: PromptMode) {
    setStrategyPromptMode(nextMode);
    if (nextMode === "market_analysis") {
      setStrategyDirectionPreference("either");
      setStrategyConfidenceTargetPct("60");
      setStrategySlTpSource("local");
      setStrategyNewsRiskMode("off");
    }
  }

  function resolveStrategyPromptMode(item: Pick<StrategyPromptTemplate, "promptMode" | "marketAnalysisUpdateEnabled">): PromptMode {
    return item.promptMode === "market_analysis" || item.marketAnalysisUpdateEnabled
      ? "market_analysis"
      : "trading_explainer";
  }

  function normalizeStrategyTimeframes(values: readonly string[]): StrategyTimeframe[] {
    const seen = new Set<StrategyTimeframe>();
    const out: StrategyTimeframe[] = [];
    for (const value of values) {
      if (!STRATEGY_TIMEFRAME_OPTIONS.includes(value as StrategyTimeframe)) continue;
      const timeframe = value as StrategyTimeframe;
      if (seen.has(timeframe)) continue;
      seen.add(timeframe);
      out.push(timeframe);
      if (out.length >= 4) break;
    }
    return out;
  }

  function parseOptionalPrice(value: string): number | null {
    const normalized = value.trim().replace(",", ".");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function buildPredictionTemplateDraft(): PredictionTemplateDraft {
    const horizonValue = Number(strategyHorizonValue);
    const confidenceTarget = Number(strategyConfidenceTargetPct);
    const ohlcvBars = Number(strategyOhlcvBars);
    return {
      schemaVersion: "prediction-template-draft/v1",
      draftId: strategyDraftId,
      revision: strategyDraftRevision,
      name: strategyName.trim(),
      analysisGoal: strategyDescription.trim(),
      promptMode: strategyPromptMode,
      timeframes: strategyTimeframes,
      runTimeframe: strategyTimeframes.length > 0
        ? (strategyRunTimeframe || strategyTimeframes[0])
        : null,
      horizon: {
        value: Number.isFinite(horizonValue) ? Math.max(1, Math.trunc(horizonValue)) : 4,
        unit: strategyHorizonUnit
      },
      indicatorKeys: strategyIndicatorKeys,
      directionRules: {
        preference: strategyPromptMode === "market_analysis" ? "either" : strategyDirectionPreference,
        long: strategyLongRule.trim(),
        short: strategyShortRule.trim(),
        noTrade: strategyNoTradeRule.trim()
      },
      priceLevels: {
        entry: parseOptionalPrice(strategyEntryLevel),
        invalidation: parseOptionalPrice(strategyInvalidationLevel),
        targets: strategyTargetLevels
          .split(/[;,\s]+/)
          .map(parseOptionalPrice)
          .filter((value): value is number => value !== null)
          .slice(0, 5)
      },
      confidenceTargetPct: Number.isFinite(confidenceTarget) ? confidenceTarget : 60,
      ohlcvBars: Number.isFinite(ohlcvBars) ? Math.trunc(ohlcvBars) : 100,
      slTpSource: strategyPromptMode === "market_analysis" ? "local" : strategySlTpSource,
      newsRiskMode: strategyPromptMode === "market_analysis" ? "off" : strategyNewsRiskMode
    };
  }

  function applyPredictionTemplateDraft(draft: PredictionTemplateDraft, keepCurrent = true) {
    if (keepCurrent) setStrategyDraftHistory((items) => [...items.slice(-9), buildPredictionTemplateDraft()]);
    setStrategyDraftRevision(draft.revision);
    setStrategyName(draft.name);
    setStrategyDescription(draft.analysisGoal);
    setStrategyPromptMode(draft.promptMode);
    setStrategyTimeframes(normalizeStrategyTimeframes(draft.timeframes));
    setStrategyRunTimeframe(draft.runTimeframe ?? "");
    setStrategyHorizonValue(String(draft.horizon.value));
    setStrategyHorizonUnit(draft.horizon.unit);
    setStrategyIndicatorKeys(draft.indicatorKeys);
    setStrategyDirectionPreference(draft.directionRules.preference);
    setStrategyLongRule(draft.directionRules.long);
    setStrategyShortRule(draft.directionRules.short);
    setStrategyNoTradeRule(draft.directionRules.noTrade);
    setStrategyEntryLevel(draft.priceLevels.entry === null ? "" : String(draft.priceLevels.entry));
    setStrategyInvalidationLevel(draft.priceLevels.invalidation === null ? "" : String(draft.priceLevels.invalidation));
    setStrategyTargetLevels(draft.priceLevels.targets.join(", "));
    setStrategyConfidenceTargetPct(String(draft.confidenceTargetPct));
    setStrategyOhlcvBars(String(draft.ohlcvBars));
    setStrategySlTpSource(draft.slTpSource);
    setStrategyNewsRiskMode(draft.newsRiskMode);
  }

  function acceptStrategyDraftProposal() {
    if (!strategyDraftProposal) return;
    applyPredictionTemplateDraft(strategyDraftProposal.draft);
    setStrategyDraftValidation(strategyDraftProposal.validation);
    setStrategyDraftProposal(null);
    setNotice(tMain("strategy.builder.diffAccepted"));
  }

  function rejectStrategyDraftProposal() {
    if (!strategyDraftProposal) return;
    setStrategyDraftProposal(null);
    setNotice(tMain("strategy.builder.diffRejected"));
  }

  function undoStrategyDraftChange() {
    const previous = strategyDraftHistory.at(-1);
    if (!previous) return;
    setStrategyDraftHistory((items) => items.slice(0, -1));
    applyPredictionTemplateDraft(previous, false);
    setStrategyDraftValidation(null);
    setStrategyDraftProposal(null);
    setNotice(tMain("strategy.builder.undoDone"));
  }

  function resetStrategyPromptEditor() {
    setStrategyEditingId(null);
    setStrategyName("");
    setStrategyDescription("");
    setStrategyIndicatorKeys([]);
    setStrategyTimeframes([]);
    setStrategyRunTimeframe("");
    setStrategyPromptMode("trading_explainer");
    setStrategyDirectionPreference("either");
    setStrategyConfidenceTargetPct("60");
    setStrategySlTpSource("local");
    setStrategyNewsRiskMode("off");
    setStrategyOhlcvBars("100");
    setStrategyPreviewOpen(false);
    setStrategyPreviewPromptText("");
    setStrategyPreviewMeta(null);
    setStrategyDraftRevision(1);
    setStrategyHorizonValue("4");
    setStrategyHorizonUnit("hours");
    setStrategyLongRule("");
    setStrategyShortRule("");
    setStrategyNoTradeRule("");
    setStrategyEntryLevel("");
    setStrategyInvalidationLevel("");
    setStrategyTargetLevels("");
    setStrategyDraftProposal(null);
    setStrategyDraftValidation(null);
    setStrategyDraftHistory([]);
    setStrategyPreviewSafety(null);
  }

  function editStrategyPrompt(item: StrategyPromptTemplate) {
    const mode = resolveStrategyPromptMode(item);
    const timeframes = normalizeStrategyTimeframes(item.timeframes);
    const runTimeframe =
      item.runTimeframe && timeframes.includes(item.runTimeframe)
        ? item.runTimeframe
        : (timeframes[0] ?? "");

    setStrategyEditingId(item.id);
    setStrategyName(item.name);
    setStrategyDescription(item.promptText);
    setStrategyIndicatorKeys(item.indicatorKeys.filter((key) => typeof key === "string" && key.trim()));
    setStrategyTimeframes(timeframes);
    setStrategyRunTimeframe(runTimeframe);
    setStrategyPromptMode(mode);
    setStrategyDirectionPreference(mode === "market_analysis" ? "either" : item.directionPreference);
    setStrategyConfidenceTargetPct(String(mode === "market_analysis" ? 60 : item.confidenceTargetPct));
    setStrategySlTpSource(mode === "market_analysis" ? "local" : item.slTpSource);
    setStrategyNewsRiskMode(mode === "market_analysis" ? "off" : item.newsRiskMode);
    setStrategyOhlcvBars(String(item.ohlcvBars));
    setStrategyPreviewPromptText(item.promptText);
    setStrategyPreviewMeta(null);
    setStrategyPreviewOpen(false);
    setStrategyDraftRevision(1);
    setStrategyLongRule(mode === "market_analysis" ? item.promptText : `Apply the saved template's long conditions: ${item.name}`);
    setStrategyShortRule(mode === "market_analysis" ? item.promptText : `Apply the saved template's short conditions: ${item.name}`);
    setStrategyNoTradeRule("No trade when required data is missing, conflicting, or outside the saved template conditions.");
    setStrategyDraftProposal(null);
    setStrategyDraftValidation(null);
    setStrategyDraftHistory([]);
    setStrategyLastSavedPromptText("");
    setStrategyLastSavedMeta(null);
    setError(null);
    setNotice(tMain("strategy.messages.editLoaded", { name: item.name }));
  }

  function cancelStrategyPromptEdit() {
    resetStrategyPromptEditor();
    setError(null);
    setNotice(tMain("strategy.messages.editCanceled"));
  }

  async function loadStrategyPrompts() {
    setStrategyLoading(true);
    try {
      const payload = await apiGet<StrategyOwnPromptsResponse>("/settings/ai-prompts/own");
      setStrategyFeatureEnabled(Boolean(payload.strategyFeatureEnabled));
      setStrategyPrompts(Array.isArray(payload.items) ? payload.items : []);
      setStrategyIndicators(Array.isArray(payload.availableIndicators) ? payload.availableIndicators : []);
    } catch {
      setStrategyFeatureEnabled(false);
      setStrategyPrompts([]);
      setStrategyIndicators([]);
    } finally {
      setStrategyLoading(false);
    }
  }

  async function generateStrategyPreview() {
    const draft = buildPredictionTemplateDraft();
    setStrategyGenerating(true);
    setError(null);
    try {
      const payload = await apiPost<{
        state: "preview_result";
        generatedPromptText: string;
        generationMeta: StrategyPromptGenerationMeta;
        validation: PredictionTemplateDraftValidation;
        safety: PredictionBuilderSafety;
      }>("/settings/ai-prompts/own/builder/preview", {
        toolName: "request_preview",
        draft
      });
      setStrategyPreviewPromptText(payload.generatedPromptText ?? "");
      setStrategyPreviewMeta(payload.generationMeta ?? null);
      setStrategyDraftValidation(payload.validation ?? null);
      setStrategyPreviewSafety(payload.safety ?? null);
      setStrategyPreviewOpen(true);
      setNotice(
        tMain("strategy.messages.previewGenerated", {
          mode: payload.generationMeta?.mode ?? "fallback",
          model: payload.generationMeta?.model ?? "n/a"
        })
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setStrategyGenerating(false);
    }
  }

  async function saveStrategyFromPreview() {
    const draft = buildPredictionTemplateDraft();
    const promptText = strategyPreviewPromptText.trim();
    if (!promptText) {
      setError(tMain("strategy.messages.previewMissing"));
      return;
    }
    setStrategySaving(true);
    try {
      const requestBody = {
        draft,
        templateId: strategyEditingId,
        generatedPromptText: promptText,
        generationMeta: strategyPreviewMeta ?? undefined,
        confirmation: {
          confirmed: true,
          acknowledgedAnalysisOnly: true
        }
      };
      const editingId = strategyEditingId;
      const payload = await apiPost<{
        state: "saved_template" | "published_template";
        prompt: StrategyPromptTemplate;
        generatedPromptText: string;
        generationMeta: StrategyPromptGenerationMeta;
        validation: PredictionTemplateDraftValidation;
        safety: PredictionBuilderSafety;
      }>("/settings/ai-prompts/own/builder/save", requestBody);
      setStrategyLastSavedPromptText(payload.generatedPromptText ?? "");
      setStrategyLastSavedMeta(payload.generationMeta ?? null);
      setStrategyDraftValidation(payload.validation ?? null);
      setStrategyPreviewSafety(payload.safety ?? null);
      if (editingId) {
        resetStrategyPromptEditor();
      } else {
        setStrategyPreviewOpen(false);
      }
      setNotice(
        editingId
          ? tMain("strategy.messages.updated")
          : tMain("strategy.messages.previewSaveSuccess", {
            mode: payload.generationMeta?.mode ?? "fallback",
            model: payload.generationMeta?.model ?? "n/a"
          })
      );
      await loadStrategyPrompts();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setStrategySaving(false);
    }
  }

  async function updateStrategyPromptFromEditor() {
    if (!strategyEditingId) return;
    await generateStrategyPreview();
  }

  async function deleteStrategyPrompt(id: string) {
    if (!window.confirm(tMain("strategy.messages.confirmDelete"))) return;
    setStrategyDeletingId(id);
    setError(null);
    setNotice(null);
    try {
      await apiDelete(`/settings/ai-prompts/own/${encodeURIComponent(id)}`);
      if (strategyEditingId === id) {
        resetStrategyPromptEditor();
      }
      await loadStrategyPrompts();
      setNotice(tMain("strategy.messages.deleted"));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setStrategyDeletingId(null);
    }
  }

  function buildStrategyDescriptionFromChat(messages: StrategyChatMessage[]): string {
    const userNotes = messages
      .filter((message) => message.role === "user")
      .map((message, index) => `${index + 1}. ${message.content}`)
      .join("\n");

    if (!userNotes) return strategyDescription;

    const selectedIndicators = strategyIndicatorKeys.length > 0
      ? strategyIndicatorKeys.join(", ")
      : tMain("strategy.chat.noneSelected");
    const timeframeText = strategyTimeframes.length > 0
      ? strategyTimeframes.join(", ")
      : tMain("strategy.chat.noneSelected");
    const modeText = strategyPromptMode === "market_analysis"
      ? tMain("strategy.promptModeAnalysis")
      : tMain("strategy.promptModeTrading");
    const directionText = strategyPromptMode === "market_analysis"
      ? tMain("strategy.directionEither")
      : strategyDirectionPreference;

    const nextDescription = [
      tMain("strategy.chat.briefHeader"),
      "",
      `${tMain("strategy.promptMode")}: ${modeText}`,
      `${tMain("strategy.timeframes")}: ${timeframeText}`,
      `${tMain("strategy.runTimeframe")}: ${strategyRunTimeframe || tMain("strategy.none")}`,
      `${tMain("strategy.directionPreference")}: ${directionText}`,
      `${tMain("strategy.confidenceTargetPct")}: ${strategyPromptMode === "market_analysis" ? "60" : strategyConfidenceTargetPct}`,
      `${tMain("strategy.slTpSource")}: ${strategyPromptMode === "market_analysis" ? "local" : strategySlTpSource}`,
      `${tMain("strategy.newsRiskMode")}: ${strategyPromptMode === "market_analysis" ? "off" : strategyNewsRiskMode}`,
      `${tMain("strategy.ohlcvBars")}: ${strategyOhlcvBars}`,
      `${tMain("strategy.chat.selectedIndicators")}: ${selectedIndicators}`,
      "",
      tMain("strategy.chat.userRequirementsHeader"),
      userNotes
    ].join("\n");

    return nextDescription.slice(0, 8000).trim();
  }

  async function submitStrategyChatMessage(raw?: string) {
    const text = trimStrategyChatText(raw ?? strategyChatInput);
    if (!text || strategyChatSending) return;

    const userMessage: StrategyChatMessage = {
      id: makeStrategyChatMessageId(),
      role: "user",
      content: text
    };
    const nextMessages = [...strategyChatMessages, userMessage];
    setStrategyChatInput("");
    setError(null);
    setNotice(null);
    setStrategyChatMessages(nextMessages);
    setStrategyChatSending(true);

    try {
      const payload = await apiPost<StrategyPromptBuilderChatResponse>(
        "/settings/ai-prompts/own/builder/chat",
        {
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          draft: buildPredictionTemplateDraft(),
          locale
        }
      );
      const assistantMessage: StrategyChatMessage = {
        id: makeStrategyChatMessageId(),
        role: "assistant",
        content: payload.assistantMessage || tMain("strategy.chat.replyReady")
      };
      setStrategyChatMessages([...nextMessages, assistantMessage]);
      setStrategyChatMeta(payload.generationMeta ?? null);
      setStrategyDraftProposal({
        draft: payload.proposedDraft,
        diff: payload.diff,
        validation: payload.validation,
        toolName: payload.toolCall.name
      });
      setStrategyDraftValidation(payload.validation);
      if (payload.readyForPreview) {
        setNotice(tMain("strategy.builder.proposalReady"));
      }
    } catch (e) {
      const assistantMessage: StrategyChatMessage = {
        id: makeStrategyChatMessageId(),
        role: "assistant",
        content: tMain("strategy.chat.aiUnavailable")
      };
      setStrategyChatMessages([...nextMessages, assistantMessage]);
      setError(errMsg(e));
    } finally {
      setStrategyChatSending(false);
    }
  }

  function syncStrategyDescriptionFromChat() {
    setStrategyDescription(buildStrategyDescriptionFromChat(strategyChatMessages));
    setNotice(tMain("strategy.chat.synced"));
    setError(null);
  }

  function resetStrategyChat() {
    setStrategyChatMessages([{
      id: makeStrategyChatMessageId(),
      role: "assistant",
      content: tMain("strategy.chat.initialMessage")
    }]);
    setStrategyChatInput("");
    setStrategyChatMeta(null);
    setNotice(tMain("strategy.chat.resetDone"));
    setError(null);
  }

  useEffect(() => {
    void loadStrategyPrompts();
  }, []);

  useEffect(() => {
    setStrategyChatMessages((current) => current.length > 0
      ? current
      : [{
        id: makeStrategyChatMessageId(),
        role: "assistant",
        content: tMain("strategy.chat.initialMessage")
      }]);
  }, [locale]);

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginTop: 0 }}>{tMain("strategy.pageTitle")}</h2>
          <p className="settingsSectionMeta" style={{ marginTop: -6 }}>
            {tMain("strategy.pageSubtitle")}
          </p>
        </div>
        <Link className="btn" href={withLocalePath("/predictions", locale)}>
          <AppIcon name="back" />
          {tMain("strategy.backToPredictions")}
        </Link>
      </div>

      {error ? <div className="errorBox">{error}</div> : null}
      {notice ? <div className="noticeBox">{notice}</div> : null}

      <section className="card settingsSection settingsLandingGroupCard settingsLandingGroupStrategy">
        <div className="settingsSectionHeader">
          <h3 style={{ margin: 0 }}>{tMain("sections.aiStrategy")}</h3>
          <div className="settingsSectionMeta">{tMain("strategy.description")}</div>
        </div>

        {!strategyFeatureEnabled && !strategyLoading ? (
          <div className="settingsMutedText">{tMain("strategy.featureDisabled")}</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="settingsInlineTitle">{tMain("strategy.ownPromptsTitle")}</div>
            {strategyLoading ? (
              <div className="settingsMutedText">{tCommon("loading")}</div>
            ) : strategyPrompts.length === 0 ? (
              <div className="settingsMutedText">{tMain("strategy.noPrompts")}</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {strategyPrompts.map((item) => {
                  const mode = resolveStrategyPromptMode(item);
                  return (
                    <div key={item.id} className="card" style={{ padding: 10, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <strong>{item.name}</strong>
                        <span className="settingsMutedText">
                          {new Date(item.updatedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="settingsMutedText">
                        {tMain("strategy.promptMode")}: {mode === "market_analysis" ? tMain("strategy.promptModeAnalysis") : tMain("strategy.promptModeTrading")}
                        {" · "}
                        {tMain("strategy.timeframesLabel")}: {item.timeframes.join(", ") || tMain("strategy.none")}
                        {" · "}
                        {tMain("strategy.runTimeframeLabel")}: {item.runTimeframe ?? tMain("strategy.none")}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={strategySaving || strategyGenerating || strategyDeletingId === item.id}
                          onClick={() => editStrategyPrompt(item)}
                        >
                          <AppIcon name="edit" />
                          {strategyEditingId === item.id ? tMain("strategy.editing") : tMain("actions.edit")}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          disabled={strategyDeletingId === item.id || strategySaving}
                          onClick={() => void deleteStrategyPrompt(item.id)}
                        >
                          <AppIcon name="delete" />
                          {strategyDeletingId === item.id ? tCommon("deleting") : tMain("actions.delete")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="settingsAccordionDivider" />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div className="settingsInlineTitle">
                {strategyEditingId ? tMain("strategy.editorTitle") : tMain("strategy.generatorTitle")}
              </div>
              {strategyEditingId ? (
                <button className="btn" type="button" onClick={cancelStrategyPromptEdit} disabled={strategySaving}>
                  <AppIcon name="cancel" />
                  {tMain("actions.cancel")}
                </button>
              ) : null}
            </div>

            <div className="settingsBuilderStateStrip" aria-label={tMain("strategy.builder.statesLabel")}>
              <span className="badge">{tMain("strategy.builder.conversationDraft")}</span>
              <span className="badge">{tMain("strategy.builder.structuredDraft")} · v1 r{strategyDraftRevision}</span>
              <span className={`badge ${strategyPreviewOpen || strategyPreviewPromptText ? "badgeOk" : ""}`}>
                {tMain("strategy.builder.previewResult")}
              </span>
              <span className={`badge ${strategyLastSavedPromptText || strategyEditingId ? "badgeOk" : ""}`}>
                {tMain("strategy.builder.savedTemplate")}
              </span>
              {strategyPrompts.some((item) => item.isPublic) ? (
                <span className="badge badgeOk">{tMain("strategy.builder.publishedTemplate")}</span>
              ) : null}
            </div>

            <div className="settingsPromptBuilder">
              <div className="settingsPromptChatPanel">
                <div className="settingsPromptChatHeader">
                  <div>
                    <div className="settingsInlineTitle">{tMain("strategy.chat.title")}</div>
                    <div className="settingsMutedText">{tMain("strategy.chat.subtitle")}</div>
                  </div>
                  <span className="badge">
                    {strategyChatSending
                      ? tMain("strategy.chat.thinking")
                      : strategyChatMeta
                        ? tMain("strategy.chat.statusWithModel", {
                          mode: strategyChatMeta.mode,
                          model: strategyChatMeta.model
                        })
                        : tMain("strategy.chat.status")}
                  </span>
                </div>
                <div className="settingsPromptChatMessages" aria-live="polite">
                  {strategyChatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`settingsPromptChatBubble settingsPromptChatBubble-${message.role}`}
                    >
                      <span className="settingsPromptChatRole">
                        {message.role === "user"
                          ? tMain("strategy.chat.userLabel")
                          : tMain("strategy.chat.assistantLabel")}
                      </span>
                      <span>{message.content}</span>
                    </div>
                  ))}
                </div>
                <div className="settingsPromptStarterRow">
                  <button
                    className="btn"
                    type="button"
                    disabled={strategyChatSending}
                    onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterTrendText"))}
                  >
                    {tMain("strategy.chat.starterTrend")}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={strategyChatSending}
                    onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterBreakoutText"))}
                  >
                    {tMain("strategy.chat.starterBreakout")}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={strategyChatSending}
                    onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterRiskText"))}
                  >
                    {tMain("strategy.chat.starterRisk")}
                  </button>
                </div>
                <div className="settingsPromptChatInputRow">
                  <textarea
                    className="input settingsPromptChatInput"
                    rows={3}
                    maxLength={1200}
                    value={strategyChatInput}
                    onChange={(event) => setStrategyChatInput(event.target.value)}
                    placeholder={tMain("strategy.chat.placeholder")}
                    disabled={strategyChatSending}
                  />
                  <button
                    className="btn btnPrimary"
                    type="button"
                    disabled={strategyChatSending || !strategyChatInput.trim()}
                    onClick={() => void submitStrategyChatMessage()}
                  >
                    <AppIcon name="send" />
                    {strategyChatSending ? tMain("strategy.chat.thinking") : tMain("strategy.chat.send")}
                  </button>
                </div>
                <div className="settingsPromptChatActions">
                  <button className="btn" type="button" onClick={syncStrategyDescriptionFromChat}>
                    <AppIcon name="transfer" />
                    {tMain("strategy.chat.sync")}
                  </button>
                  <button className="btn" type="button" onClick={resetStrategyChat}>
                    <AppIcon name="reset" />
                    {tMain("strategy.chat.reset")}
                  </button>
                </div>
              </div>
              <aside className="settingsPredictionDraftPanel">
                <div className="settingsPromptChatHeader">
                  <div>
                    <div className="settingsInlineTitle">{tMain("strategy.builder.draftTitle")}</div>
                    <div className="settingsMutedText">{tMain("strategy.builder.draftSubtitle")}</div>
                  </div>
                  <span className="badge">v1 · r{strategyDraftRevision}</span>
                </div>

                {strategyDraftProposal ? (
                  <div className="settingsDraftDiff" aria-live="polite">
                    <div className="settingsDraftDiffHeader">
                      <strong>{tMain("strategy.builder.diffTitle")}</strong>
                      <span className="badge">{strategyDraftProposal.toolName}</span>
                    </div>
                    {strategyDraftProposal.diff.length > 0 ? (
                      <div className="settingsDraftDiffList">
                        {strategyDraftProposal.diff.map((change) => (
                          <div className="settingsDraftDiffRow" key={change.path}>
                            <code>{change.path}</code>
                            <span className="settingsDraftDiffBefore">{String(change.before ?? "—")}</span>
                            <span aria-hidden="true">→</span>
                            <span>{String(change.after ?? "—")}</span>
                          </div>
                        ))}
                      </div>
                    ) : <div className="settingsMutedText">{tMain("strategy.builder.noDiff")}</div>}
                    <div className="settingsPromptChatActions">
                      <button className="btn btnPrimary" type="button" onClick={acceptStrategyDraftProposal}>
                        <AppIcon name="check" />
                        {tMain("strategy.builder.acceptDiff")}
                      </button>
                      <button className="btn" type="button" onClick={rejectStrategyDraftProposal}>
                        <AppIcon name="cancel" />
                        {tMain("strategy.builder.rejectDiff")}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="settingsTwoColGrid">
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.builder.horizon")}</span>
                    <input className="input" type="number" min={1} value={strategyHorizonValue} onChange={(event) => setStrategyHorizonValue(event.target.value)} />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.builder.horizonUnit")}</span>
                    <select className="input" value={strategyHorizonUnit} onChange={(event) => setStrategyHorizonUnit(event.target.value as "minutes" | "hours" | "days")}>
                      <option value="minutes">{tMain("strategy.builder.minutes")}</option>
                      <option value="hours">{tMain("strategy.builder.hours")}</option>
                      <option value="days">{tMain("strategy.builder.days")}</option>
                    </select>
                  </label>
                </div>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{tMain("strategy.builder.longRule")}</span>
                  <textarea className="input" rows={2} maxLength={2000} value={strategyLongRule} onChange={(event) => setStrategyLongRule(event.target.value)} />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{tMain("strategy.builder.shortRule")}</span>
                  <textarea className="input" rows={2} maxLength={2000} value={strategyShortRule} onChange={(event) => setStrategyShortRule(event.target.value)} />
                </label>
                <label className="settingsField">
                  <span className="settingsFieldLabel">{tMain("strategy.builder.noTradeRule")}</span>
                  <textarea className="input" rows={2} maxLength={2000} value={strategyNoTradeRule} onChange={(event) => setStrategyNoTradeRule(event.target.value)} />
                </label>
                <div className="settingsThreeColGrid">
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.builder.entryLevel")}</span>
                    <input className="input" inputMode="decimal" value={strategyEntryLevel} onChange={(event) => setStrategyEntryLevel(event.target.value)} />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.builder.invalidationLevel")}</span>
                    <input className="input" inputMode="decimal" value={strategyInvalidationLevel} onChange={(event) => setStrategyInvalidationLevel(event.target.value)} />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.builder.targetLevels")}</span>
                    <input className="input" value={strategyTargetLevels} onChange={(event) => setStrategyTargetLevels(event.target.value)} placeholder="105, 110" />
                  </label>
                </div>

                {strategyDraftValidation ? (
                  <div className={strategyDraftValidation.valid ? "settingsDraftValidationOk" : "settingsDraftValidationError"}>
                    <strong>{strategyDraftValidation.valid ? tMain("strategy.builder.validDraft") : tMain("strategy.builder.invalidDraft")}</strong>
                    {strategyDraftValidation.issues.length > 0 ? (
                      <ul>
                        {strategyDraftValidation.issues.map((issue) => <li key={`${issue.path}-${issue.code}`}>{issue.message}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                <div className="settingsPromptChatActions">
                  <button className="btn" type="button" disabled={strategyDraftHistory.length === 0} onClick={undoStrategyDraftChange}>
                    <AppIcon name="restore" />
                    {tMain("strategy.builder.undo")}
                  </button>
                </div>
                <div className="settingsBuilderSafetyNote">
                  <AppIcon name="shield" />
                  <span>{tMain("strategy.builder.safetyBoundary")}</span>
                </div>
              </aside>
            </div>

            <label className="settingsField">
              <span className="settingsFieldLabel">{tMain("strategy.promptName")}</span>
              <input
                className="input"
                value={strategyName}
                maxLength={64}
                onChange={(event) => setStrategyName(event.target.value)}
                placeholder={tMain("strategy.promptNamePlaceholder")}
              />
            </label>
            <label className="settingsField">
              <span className="settingsFieldLabel">{tMain("strategy.strategyDescription")}</span>
              <textarea
                className="input"
                rows={6}
                maxLength={8000}
                value={strategyDescription}
                onChange={(event) => setStrategyDescription(event.target.value)}
                placeholder={tMain("strategy.strategyPlaceholder")}
              />
            </label>

            {strategyEditingId ? (
              <label className="settingsField">
                <span className="settingsFieldLabel">{tMain("strategy.promptText")}</span>
                <textarea
                  className="input"
                  rows={12}
                  maxLength={8000}
                  value={strategyPreviewPromptText}
                  onChange={(event) => setStrategyPreviewPromptText(event.target.value)}
                  placeholder={tMain("strategy.promptTextPlaceholder")}
                />
                <span className="settingsMutedText">{tMain("strategy.promptTextHint")}</span>
              </label>
            ) : null}

            <label className="settingsField">
              <span className="settingsFieldLabel">{tMain("strategy.promptMode")}</span>
              <select
                className="input"
                value={strategyPromptMode}
                onChange={(event) => handleStrategyPromptModeChange(event.target.value as PromptMode)}
              >
                <option value="trading_explainer">{tMain("strategy.promptModeTrading")}</option>
                <option value="market_analysis">{tMain("strategy.promptModeAnalysis")}</option>
              </select>
              <span className="settingsMutedText">
                {strategyPromptMode === "market_analysis"
                  ? tMain("strategy.analysisAutoDefaultsHint")
                  : tMain("strategy.promptModeHint")}
              </span>
            </label>

            <div className="settingsTwoColGrid">
              <label className="settingsField">
                <span className="settingsFieldLabel">{tMain("strategy.timeframes")}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {STRATEGY_TIMEFRAME_OPTIONS.map((tf) => (
                    <label key={`strategy-tf-${tf}`} className="inlineCheck">
                      <input
                        type="checkbox"
                        checked={strategyTimeframes.includes(tf)}
                        onChange={() => toggleStrategyTimeframe(tf)}
                      />
                      {tf}
                    </label>
                  ))}
                </div>
              </label>
              <label className="settingsField">
                <span className="settingsFieldLabel">{tMain("strategy.runTimeframe")}</span>
                <select
                  className="input"
                  value={strategyRunTimeframe}
                  onChange={(event) => setStrategyRunTimeframe(event.target.value as "" | StrategyTimeframe)}
                  disabled={strategyTimeframes.length === 0}
                >
                  {strategyTimeframes.length === 0 ? <option value="">{tMain("strategy.noTimeframeLock")}</option> : null}
                  {strategyTimeframes.map((tf) => (
                    <option key={`strategy-run-${tf}`} value={tf}>{tf}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="settingsTwoColGrid">
              {strategyPromptMode === "trading_explainer" ? (
                <>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.directionPreference")}</span>
                    <select
                      className="input"
                      value={strategyDirectionPreference}
                      onChange={(event) => setStrategyDirectionPreference(event.target.value as "long" | "short" | "either")}
                    >
                      <option value="either">{tMain("strategy.directionEither")}</option>
                      <option value="long">{tMain("strategy.directionLong")}</option>
                      <option value="short">{tMain("strategy.directionShort")}</option>
                    </select>
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.confidenceTargetPct")}</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={strategyConfidenceTargetPct}
                      onChange={(event) => setStrategyConfidenceTargetPct(event.target.value)}
                    />
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.slTpSource")}</span>
                    <select
                      className="input"
                      value={strategySlTpSource}
                      onChange={(event) => setStrategySlTpSource(event.target.value as "local" | "ai" | "hybrid")}
                    >
                      <option value="local">{tMain("strategy.slTpSourceLocal")}</option>
                      <option value="ai">{tMain("strategy.slTpSourceAi")}</option>
                      <option value="hybrid">{tMain("strategy.slTpSourceHybrid")}</option>
                    </select>
                  </label>
                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.newsRiskMode")}</span>
                    <select
                      className="input"
                      value={strategyNewsRiskMode}
                      onChange={(event) => setStrategyNewsRiskMode(event.target.value as "off" | "block")}
                    >
                      <option value="off">{tMain("strategy.newsRiskModeOff")}</option>
                      <option value="block">{tMain("strategy.newsRiskModeBlock")}</option>
                    </select>
                  </label>
                </>
              ) : null}
              <label className="settingsField">
                <span className="settingsFieldLabel">{tMain("strategy.ohlcvBars")}</span>
                <input
                  className="input"
                  type="number"
                  min={20}
                  max={500}
                  step={1}
                  value={strategyOhlcvBars}
                  onChange={(event) => setStrategyOhlcvBars(event.target.value)}
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => setStrategyIndicatorKeys(strategyIndicators.map((item) => item.key))}
              >
                <AppIcon name="check" />
                {tMain("strategy.selectAllIndicators")}
              </button>
              <button className="btn" type="button" onClick={() => setStrategyIndicatorKeys([])}>
                <AppIcon name="remove" />
                {tMain("strategy.clearIndicators")}
              </button>
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              {strategyIndicators.map((item) => (
                <label
                  key={`strategy-ind-${item.key}`}
                  className="inlineCheck"
                  style={{
                    border: "1px solid rgba(255, 193, 7, 0.2)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    alignItems: "flex-start",
                    gap: 8
                  }}
                >
                  <input
                    type="checkbox"
                    checked={strategyIndicatorKeys.includes(item.key)}
                    onChange={() => toggleStrategyIndicator(item.key)}
                    style={{ marginTop: 2 }}
                  />
                  <span style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                    <span className="settingsMutedText">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className={`btn ${strategyEditingId ? "" : "btnPrimary"}`}
                type="button"
                disabled={strategyGenerating || strategySaving}
                onClick={() => void generateStrategyPreview()}
              >
                <AppIcon name="preview" />
                {strategyGenerating ? tMain("strategy.previewGenerating") : tMain("strategy.generatePreview")}
              </button>
              {strategyEditingId ? (
                <>
                  <button
                    className="btn btnPrimary"
                    type="button"
                    disabled={strategyGenerating || strategySaving}
                    onClick={() => void updateStrategyPromptFromEditor()}
                  >
                    <AppIcon name="save" />
                    {strategySaving ? tMain("strategy.updateSaving") : tMain("strategy.updatePrompt")}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={strategySaving}
                    onClick={cancelStrategyPromptEdit}
                  >
                    <AppIcon name="cancel" />
                    {tMain("actions.cancel")}
                  </button>
                </>
              ) : null}
            </div>

            {strategyLastSavedPromptText ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div className="settingsMutedText">
                  {strategyLastSavedMeta
                    ? tMain("strategy.resultMeta", {
                      mode: strategyLastSavedMeta.mode,
                      model: strategyLastSavedMeta.model
                    })
                    : ""}
                </div>
                <textarea className="input" rows={12} readOnly value={strategyLastSavedPromptText} />
                <div className="settingsBuilderSafetyNote">
                  <AppIcon name="shield" />
                  <span>{tMain("strategy.builder.savedWithoutCopier")}</span>
                </div>
                <Link className="btn" href={withLocalePath("/bots/new?review=1&strategy=prediction_copier", locale)}>
                  <AppIcon name="external" />
                  {tMain("strategy.builder.openCopierReview")}
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {strategyPreviewOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16
          }}
          onClick={() => {
            if (!strategySaving) setStrategyPreviewOpen(false);
          }}
        >
          <div
            className="card"
            style={{ width: "min(1000px, 95vw)", maxHeight: "90vh", display: "grid", gap: 10, padding: 16 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settingsSectionHeader">
              <h3 style={{ margin: 0 }}>{tMain("strategy.previewTitle")}</h3>
            </div>
            <div className="settingsMutedText">
              {strategyPreviewMeta
                ? tMain("strategy.previewHint", {
                  mode: strategyPreviewMeta.mode,
                  model: strategyPreviewMeta.model
                })
                : tMain("strategy.previewHint", { mode: "fallback", model: "n/a" })}
            </div>
            <div className="settingsBuilderSafetyNote">
              <AppIcon name="shield" />
              <span>
                {strategyPreviewSafety
                  ? tMain("strategy.builder.previewSafetyVerified")
                  : tMain("strategy.builder.previewSafety")}
              </span>
            </div>
            <textarea
              className="input"
              rows={18}
              maxLength={8000}
              value={strategyPreviewPromptText}
              onChange={(event) => setStrategyPreviewPromptText(event.target.value)}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={strategySaving}
                onClick={() => setStrategyPreviewOpen(false)}
              >
                <AppIcon name="cancel" />
                {tMain("strategy.previewCancel")}
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                disabled={strategySaving}
                onClick={() => void saveStrategyFromPreview()}
              >
                <AppIcon name="save" />
                {strategySaving
                  ? tMain("strategy.previewSaving")
                  : (strategyEditingId ? tMain("strategy.builder.confirmUpdate") : tMain("strategy.builder.confirmSave"))}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
