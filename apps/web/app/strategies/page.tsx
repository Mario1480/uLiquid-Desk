"use client";
import { GlassProgress } from "@/components/einui/liquid-glass/glass-progress";
import { DeskCheckbox } from "@/components/desk/DeskCheckbox";
import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskLink } from "@/components/desk/DeskLink";

import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { DeskSurface } from "@/components/desk/DeskSurface";
import { DeskTextarea } from "@/components/desk/DeskTextarea";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPost } from "../../lib/api";
import { withLocalePath, type AppLocale } from "../../i18n/config";
import AdminConfirmDialog from "../admin/_components/AdminConfirmDialog";
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
type StrategyBuilderStep = 1 | 2 | 3;

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
  const [strategyLoading, setStrategyLoading] = useState(true);
  const [strategyGenerating, setStrategyGenerating] = useState(false);
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyDeletingId, setStrategyDeletingId] = useState<string | null>(null);
  const [strategyDeletePendingId, setStrategyDeletePendingId] = useState<string | null>(null);
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
  const [strategyBuilderStep, setStrategyBuilderStep] = useState<StrategyBuilderStep>(1);
  const [strategyIndicatorSearch, setStrategyIndicatorSearch] = useState("");

  const selectedStrategyIndicators = useMemo(() => {
    const selected = new Set(strategyIndicatorKeys);
    return strategyIndicators.filter((item) => selected.has(item.key));
  }, [strategyIndicatorKeys, strategyIndicators]);

  const groupedStrategyIndicators = useMemo(() => {
    const query = strategyIndicatorSearch.trim().toLocaleLowerCase(locale);
    const groups = new Map<string, StrategyIndicatorOption[]>();
    for (const item of strategyIndicators) {
      if (query && !`${item.label} ${item.description} ${item.group}`.toLocaleLowerCase(locale).includes(query)) {
        continue;
      }
      const group = item.group.trim() || tMain("strategy.builder.indicatorOther");
      groups.set(group, [...(groups.get(group) ?? []), item]);
    }
    return [...groups.entries()];
  }, [locale, strategyIndicatorSearch, strategyIndicators, tMain]);

  const strategyCompletionItems = [
    Boolean(strategyName.trim()),
    Boolean(strategyDescription.trim()),
    strategyTimeframes.length > 0,
    Boolean(strategyRunTimeframe),
    Boolean(strategyHorizonValue),
    strategyPromptMode === "market_analysis" || Boolean(strategyLongRule.trim()),
    strategyPromptMode === "market_analysis" || Boolean(strategyShortRule.trim()),
    Boolean(strategyNoTradeRule.trim()),
    strategyIndicatorKeys.length > 0
  ];
  const strategyCompletionCount = strategyCompletionItems.filter(Boolean).length;

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
    setStrategyBuilderStep(1);
    setStrategyIndicatorSearch("");
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
    setStrategyDraftRevision(1);
    setStrategyLongRule(mode === "market_analysis" ? item.promptText : `Apply the saved template's long conditions: ${item.name}`);
    setStrategyShortRule(mode === "market_analysis" ? item.promptText : `Apply the saved template's short conditions: ${item.name}`);
    setStrategyNoTradeRule("No trade when required data is missing, conflicting, or outside the saved template conditions.");
    setStrategyDraftProposal(null);
    setStrategyDraftValidation(null);
    setStrategyDraftHistory([]);
    setStrategyLastSavedPromptText("");
    setStrategyLastSavedMeta(null);
    setStrategyBuilderStep(1);
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
      setStrategyBuilderStep(3);
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

  async function deleteStrategyPrompt(id: string) {
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
      setStrategyDescription(buildStrategyDescriptionFromChat(nextMessages));
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

  function continueToStrategyRules() {
    const nextDescription = strategyDescription.trim() || buildStrategyDescriptionFromChat(strategyChatMessages);
    if (!strategyName.trim()) {
      setError(tMain("strategy.messages.promptNameRequired"));
      return;
    }
    if (!nextDescription.trim()) {
      setError(tMain("strategy.messages.strategyRequired"));
      return;
    }
    setStrategyDescription(nextDescription);
    setStrategyBuilderStep(2);
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
    <div className="uiPage predictionBuilderPage">
      <header className="uiPageHeader predictionBuilderPageHeader">
        <div>
          <div className="predictionBuilderBreadcrumb">
            <Link href={withLocalePath("/predictions", locale)}>{tMain("strategy.backToPredictionsShort")}</Link>
            <AppIcon name="chevronRight" />
            <span>{tMain("strategy.pageTitle")}</span>
          </div>
          <h2>{tMain("strategy.pageTitle")}</h2>
          <p>{tMain("strategy.pageSubtitle")}</p>
        </div>
        {strategyEditingId ? (
          <DeskButton className="btn" type="button" onClick={cancelStrategyPromptEdit} disabled={strategySaving}>
            <AppIcon name="cancel" />
            {tMain("actions.cancel")}
          </DeskButton>
        ) : null}
      </header>

      {error ? <div className="errorBox" role="alert">{error}</div> : null}
      {notice ? <div className="noticeBox" role="status">{notice}</div> : null}

      {!strategyFeatureEnabled && !strategyLoading ? (
        <section className="uiSection">
          <div className="settingsMutedText">{tMain("strategy.featureDisabled")}</div>
        </section>
      ) : (
        <>
          <nav className="predictionBuilderStepper" aria-label={tMain("strategy.builder.stepsLabel")}>
            <DeskButton
              className={strategyBuilderStep === 1 ? "predictionBuilderStep predictionBuilderStepActive" : "predictionBuilderStep"}
              type="button"
              aria-current={strategyBuilderStep === 1 ? "step" : undefined}
              onClick={() => setStrategyBuilderStep(1)}
            >
              <span className="predictionBuilderStepNumber">
                {strategyBuilderStep > 1 ? <AppIcon name="check" /> : "1"}
              </span>
              <span>
                <strong>{tMain("strategy.builder.ideaStep")}</strong>
                <small>{tMain("strategy.builder.ideaStepHint")}</small>
              </span>
            </DeskButton>
            <DeskButton
              className={strategyBuilderStep === 2 ? "predictionBuilderStep predictionBuilderStepActive" : "predictionBuilderStep"}
              type="button"
              aria-current={strategyBuilderStep === 2 ? "step" : undefined}
              disabled={!strategyName.trim() || !strategyDescription.trim()}
              onClick={() => setStrategyBuilderStep(2)}
            >
              <span className="predictionBuilderStepNumber">
                {strategyBuilderStep > 2 ? <AppIcon name="check" /> : "2"}
              </span>
              <span>
                <strong>{tMain("strategy.builder.rulesStep")}</strong>
                <small>{tMain("strategy.builder.rulesStepHint")}</small>
              </span>
            </DeskButton>
            <DeskButton
              className={strategyBuilderStep === 3 ? "predictionBuilderStep predictionBuilderStepActive" : "predictionBuilderStep"}
              type="button"
              aria-current={strategyBuilderStep === 3 ? "step" : undefined}
              disabled={!strategyPreviewPromptText}
              onClick={() => setStrategyBuilderStep(3)}
            >
              <span className="predictionBuilderStepNumber">3</span>
              <span>
                <strong>{tMain("strategy.builder.reviewStep")}</strong>
                <small>{tMain("strategy.builder.reviewStepHint")}</small>
              </span>
            </DeskButton>
          </nav>

          <details className="predictionTemplateLibrary">
            <summary>
              <span>
                <AppIcon name="template" />
                <strong>{tMain("strategy.builder.templatesSummary", { count: strategyPrompts.length })}</strong>
              </span>
              <AppIcon name="chevronDown" />
            </summary>
            <div className="predictionTemplateList">
              {strategyLoading ? (
                <div className="settingsMutedText">{tCommon("loading")}</div>
              ) : strategyPrompts.length === 0 ? (
                <div className="settingsMutedText">{tMain("strategy.noPrompts")}</div>
              ) : strategyPrompts.map((item) => {
                const mode = resolveStrategyPromptMode(item);
                return (
                  <div className="predictionTemplateRow" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {mode === "market_analysis" ? tMain("strategy.promptModeAnalysis") : tMain("strategy.promptModeTrading")}
                        {" · "}
                        {item.timeframes.join(", ") || tMain("strategy.none")}
                        {" · "}
                        {new Date(item.updatedAt).toLocaleDateString(locale)}
                      </span>
                    </div>
                    <div className="predictionTemplateActions">
                      <DeskButton
                        className="btn"
                        type="button"
                        disabled={strategySaving || strategyGenerating || strategyDeletingId === item.id}
                        onClick={() => editStrategyPrompt(item)}
                      >
                        <AppIcon name="edit" />
                        {tMain("actions.edit")}
                      </DeskButton>
                      <DeskButton
                        className="btn btnDangerGhost"
                        type="button"
                        disabled={strategyDeletingId === item.id || strategySaving}
                        onClick={() => setStrategyDeletePendingId(item.id)}
                      >
                        <AppIcon name="delete" />
                        {strategyDeletingId === item.id ? tCommon("deleting") : tMain("actions.delete")}
                      </DeskButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          {strategyBuilderStep === 1 ? (
            <>
              <div className="predictionBuilderIdeaLayout">
                <section className="uiSection predictionBuilderAssistant">
                  <div className="uiSectionHeader">
                    <div>
                      <h3>{tMain("strategy.builder.describeTitle")}</h3>
                      <p>{tMain("strategy.builder.describeHint")}</p>
                    </div>
                    <DeskBadge className="badge">
                      {strategyChatSending ? tMain("strategy.chat.thinking") : tMain("strategy.chat.status")}
                    </DeskBadge>
                  </div>

                  <label className="settingsField">
                    <span className="settingsFieldLabel">{tMain("strategy.promptName")}</span>
                    <DeskInput
                      className="input"
                      value={strategyName}
                      maxLength={64}
                      onChange={(event) => setStrategyName(event.target.value)}
                      placeholder={tMain("strategy.promptNamePlaceholder")}
                    />
                  </label>

                  <fieldset className="predictionBuilderSegmentField">
                    <legend>{tMain("strategy.builder.strategyType")}</legend>
                    <div className="predictionBuilderSegmented">
                      <DeskButton
                        type="button"
                        aria-pressed={strategyPromptMode === "trading_explainer"}
                        className={strategyPromptMode === "trading_explainer" ? "predictionBuilderSegmentActive" : ""}
                        onClick={() => handleStrategyPromptModeChange("trading_explainer")}
                      >
                        {tMain("strategy.builder.tradingSetup")}
                      </DeskButton>
                      <DeskButton
                        type="button"
                        aria-pressed={strategyPromptMode === "market_analysis"}
                        className={strategyPromptMode === "market_analysis" ? "predictionBuilderSegmentActive" : ""}
                        onClick={() => handleStrategyPromptModeChange("market_analysis")}
                      >
                        {tMain("strategy.promptModeAnalysis")}
                      </DeskButton>
                    </div>
                  </fieldset>

                  <div className="predictionBuilderAssistantLabel">
                    <div>
                      <strong>{tMain("strategy.chat.title")}</strong>
                      <span>{tMain("strategy.builder.assistantHint")}</span>
                    </div>
                    {strategyChatMeta ? <DeskBadge className="badge">{strategyChatMeta.model}</DeskBadge> : null}
                  </div>

                  <div className="settingsPromptChatMessages predictionBuilderChatMessages" aria-live="polite">
                    {strategyChatMessages.map((message) => (
                      <div
                        key={message.id}
                        className={"settingsPromptChatBubble settingsPromptChatBubble-" + message.role}
                      >
                        <span className="settingsPromptChatRole">
                          {message.role === "user" ? tMain("strategy.chat.userLabel") : tMain("strategy.chat.assistantLabel")}
                        </span>
                        <span>{message.content}</span>
                      </div>
                    ))}
                  </div>

                  <div className="settingsPromptStarterRow">
                    <DeskButton className="btn" type="button" disabled={strategyChatSending} onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterTrendText"))}>
                      {tMain("strategy.chat.starterTrend")}
                    </DeskButton>
                    <DeskButton className="btn" type="button" disabled={strategyChatSending} onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterBreakoutText"))}>
                      {tMain("strategy.chat.starterBreakout")}
                    </DeskButton>
                    <DeskButton className="btn" type="button" disabled={strategyChatSending} onClick={() => void submitStrategyChatMessage(tMain("strategy.chat.starterRiskText"))}>
                      {tMain("strategy.chat.starterRisk")}
                    </DeskButton>
                  </div>

                  <div className="settingsPromptChatInputRow predictionBuilderChatComposer">
                    <DeskTextarea
                      className="input settingsPromptChatInput"
                      rows={4}
                      maxLength={1200}
                      value={strategyChatInput}
                      onChange={(event) => setStrategyChatInput(event.target.value)}
                      placeholder={tMain("strategy.chat.placeholder")}
                      disabled={strategyChatSending}
                    />
                    <DeskButton
                      className="btn btnPrimary"
                      type="button"
                      disabled={strategyChatSending || !strategyChatInput.trim()}
                      onClick={() => void submitStrategyChatMessage()}
                    >
                      <AppIcon name="send" />
                      {strategyChatSending ? tMain("strategy.chat.thinking") : tMain("strategy.builder.sendToAi")}
                    </DeskButton>
                  </div>
                </section>

                <aside className="uiSection predictionBuilderLiveBrief">
                  <div className="uiSectionHeader">
                    <div>
                      <h3>{tMain("strategy.builder.liveBriefTitle")}</h3>
                      <p>{tMain("strategy.builder.liveBriefHint")}</p>
                    </div>
                    <span className="predictionBuilderSavedState">
                      <AppIcon name="check" />
                      {tMain("strategy.builder.draftState", { revision: strategyDraftRevision })}
                    </span>
                  </div>

                  {strategyDraftProposal ? (
                    <div className="settingsDraftDiff" aria-live="polite">
                      <div className="settingsDraftDiffHeader">
                        <strong>{tMain("strategy.builder.diffTitle")}</strong>
                        <DeskBadge className="badge">{strategyDraftProposal.diff.length}</DeskBadge>
                      </div>
                      <div className="settingsDraftDiffList">
                        {strategyDraftProposal.diff.slice(0, 5).map((change) => (
                          <div className="settingsDraftDiffRow" key={change.path}>
                            <code>{change.path}</code>
                            <span className="settingsDraftDiffBefore">{String(change.before ?? "—")}</span>
                            <span aria-hidden="true">→</span>
                            <span>{String(change.after ?? "—")}</span>
                          </div>
                        ))}
                      </div>
                      <div className="settingsPromptChatActions">
                        <DeskButton className="btn btnPrimary" type="button" onClick={acceptStrategyDraftProposal}>
                          <AppIcon name="check" />
                          {tMain("strategy.builder.acceptDiff")}
                        </DeskButton>
                        <DeskButton className="btn" type="button" onClick={rejectStrategyDraftProposal}>
                          <AppIcon name="cancel" />
                          {tMain("strategy.builder.rejectDiff")}
                        </DeskButton>
                      </div>
                    </div>
                  ) : null}

                  <dl className="predictionBuilderBriefList">
                    <div>
                      <dt>{tMain("strategy.builder.analysisGoal")}</dt>
                      <dd>{strategyDescription.trim() || tMain("strategy.builder.briefEmpty")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.marketContextTitle")}</dt>
                      <dd>
                        {strategyTimeframes.length > 0 ? strategyTimeframes.join(", ") : tMain("strategy.builder.notDefined")}
                        {" · "}
                        {strategyHorizonValue} {tMain("strategy.builder." + strategyHorizonUnit)}
                      </dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.directionPreference")}</dt>
                      <dd>
                        {strategyPromptMode === "market_analysis"
                          ? tMain("strategy.directionEither")
                          : tMain("strategy.direction" + (strategyDirectionPreference === "either" ? "Either" : strategyDirectionPreference === "long" ? "Long" : "Short"))}
                      </dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.rulesTitle")}</dt>
                      <dd>{strategyNoTradeRule.trim() || tMain("strategy.builder.rulesPending")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.selectedIndicators")}</dt>
                      <dd className="predictionBuilderChipRow">
                        {selectedStrategyIndicators.length > 0
                          ? selectedStrategyIndicators.map((item) => <DeskBadge className="predictionBuilderChip" key={item.key}>{item.label}</DeskBadge>)
                          : <span>{tMain("strategy.builder.noIndicators")}</span>}
                      </dd>
                    </div>
                  </dl>

                  {strategyDraftHistory.length > 0 ? (
                    <DeskButton className="btn predictionBuilderUndo" type="button" onClick={undoStrategyDraftChange}>
                      <AppIcon name="restore" />
                      {tMain("strategy.builder.undo")}
                    </DeskButton>
                  ) : null}
                </aside>
              </div>

              <footer className="predictionBuilderActionBar">
                <div className="predictionBuilderSafety">
                  <AppIcon name="shield" />
                  <span>{tMain("strategy.builder.safetyShort")}</span>
                </div>
                <div className="predictionBuilderActionButtons">
                  <DeskButton className="btn" type="button" onClick={syncStrategyDescriptionFromChat}>
                    <AppIcon name="refresh" />
                    {tMain("strategy.builder.updateDraft")}
                  </DeskButton>
                  <DeskButton className="btn btnPrimary" type="button" onClick={continueToStrategyRules}>
                    {tMain("strategy.builder.continueRules")}
                    <AppIcon name="chevronRight" />
                  </DeskButton>
                </div>
              </footer>
            </>
          ) : null}

          {strategyBuilderStep === 2 ? (
            <>
              <div className="predictionBuilderConfigLayout">
                <main className="uiSection predictionBuilderConfigMain">
                  <section className="predictionBuilderConfigSection">
                    <div className="predictionBuilderConfigHeading">
                      <AppIcon name="performance" />
                      <div>
                        <h3>{tMain("strategy.builder.marketContextTitle")}</h3>
                        <p>{tMain("strategy.builder.marketContextHint")}</p>
                      </div>
                    </div>
                    <div className="predictionBuilderContextGrid">
                      <fieldset className="predictionBuilderTimeframes">
                        <legend>{tMain("strategy.timeframes")}</legend>
                        <div className="predictionBuilderChoiceRow">
                          {STRATEGY_TIMEFRAME_OPTIONS.map((timeframe) => (
                            <label className={strategyTimeframes.includes(timeframe) ? "predictionBuilderChoice predictionBuilderChoiceActive" : "predictionBuilderChoice"} key={timeframe}>
                              <DeskCheckbox
                                checked={strategyTimeframes.includes(timeframe)}
                                onCheckedChange={() => toggleStrategyTimeframe(timeframe)}
                              />
                              {timeframe}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("strategy.runTimeframe")}</span>
                        <DeskSelect className="input" value={strategyRunTimeframe} onChange={(event) => setStrategyRunTimeframe(event.target.value as "" | StrategyTimeframe)} disabled={strategyTimeframes.length === 0}>
                          {strategyTimeframes.length === 0 ? <option value="">{tMain("strategy.noTimeframeLock")}</option> : null}
                          {strategyTimeframes.map((timeframe) => <option value={timeframe} key={timeframe}>{timeframe}</option>)}
                        </DeskSelect>
                      </label>
                      <div className="predictionBuilderHorizonField">
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.builder.horizon")}</span>
                          <DeskInput className="input" type="number" min={1} value={strategyHorizonValue} onChange={(event) => setStrategyHorizonValue(event.target.value)} />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.builder.horizonUnit")}</span>
                          <DeskSelect className="input" value={strategyHorizonUnit} onChange={(event) => setStrategyHorizonUnit(event.target.value as "minutes" | "hours" | "days")}>
                            <option value="minutes">{tMain("strategy.builder.minutes")}</option>
                            <option value="hours">{tMain("strategy.builder.hours")}</option>
                            <option value="days">{tMain("strategy.builder.days")}</option>
                          </DeskSelect>
                        </label>
                      </div>
                      {strategyPromptMode === "trading_explainer" ? (
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.directionPreference")}</span>
                          <DeskSelect className="input" value={strategyDirectionPreference} onChange={(event) => setStrategyDirectionPreference(event.target.value as "long" | "short" | "either")}>
                            <option value="either">{tMain("strategy.directionEither")}</option>
                            <option value="long">{tMain("strategy.directionLong")}</option>
                            <option value="short">{tMain("strategy.directionShort")}</option>
                          </DeskSelect>
                        </label>
                      ) : null}
                    </div>
                  </section>

                  <section className="predictionBuilderConfigSection">
                    <div className="predictionBuilderConfigHeading">
                      <AppIcon name="strategies" />
                      <div>
                        <h3>{tMain("strategy.builder.rulesTitle")}</h3>
                        <p>{tMain("strategy.builder.rulesHint")}</p>
                      </div>
                    </div>
                    <div className="predictionBuilderRuleGrid">
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("strategy.builder.longRule")}</span>
                        <DeskTextarea className="input" rows={3} maxLength={2000} value={strategyLongRule} onChange={(event) => setStrategyLongRule(event.target.value)} />
                      </label>
                      <label className="settingsField">
                        <span className="settingsFieldLabel">{tMain("strategy.builder.shortRule")}</span>
                        <DeskTextarea className="input" rows={3} maxLength={2000} value={strategyShortRule} onChange={(event) => setStrategyShortRule(event.target.value)} />
                      </label>
                      <label className="settingsField predictionBuilderRuleWide">
                        <span className="settingsFieldLabel">{tMain("strategy.builder.noTradeRule")}</span>
                        <DeskTextarea className="input" rows={3} maxLength={2000} value={strategyNoTradeRule} onChange={(event) => setStrategyNoTradeRule(event.target.value)} />
                      </label>
                    </div>
                  </section>

                  {strategyPromptMode === "trading_explainer" ? (
                    <section className="predictionBuilderConfigSection">
                      <div className="predictionBuilderConfigHeading">
                        <AppIcon name="risk" />
                        <div>
                          <h3>{tMain("strategy.builder.riskTitle")}</h3>
                          <p>{tMain("strategy.builder.riskHint")}</p>
                        </div>
                      </div>
                      <div className="predictionBuilderRiskGrid">
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.builder.entryLevel")}</span>
                          <DeskInput className="input" inputMode="decimal" value={strategyEntryLevel} onChange={(event) => setStrategyEntryLevel(event.target.value)} />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.builder.invalidationLevel")}</span>
                          <DeskInput className="input" inputMode="decimal" value={strategyInvalidationLevel} onChange={(event) => setStrategyInvalidationLevel(event.target.value)} />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.builder.targetLevels")}</span>
                          <DeskInput className="input" value={strategyTargetLevels} onChange={(event) => setStrategyTargetLevels(event.target.value)} placeholder="105, 110" />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.confidenceTargetPct")}</span>
                          <DeskInput className="input" type="number" min={0} max={100} step={1} value={strategyConfidenceTargetPct} onChange={(event) => setStrategyConfidenceTargetPct(event.target.value)} />
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.newsRiskMode")}</span>
                          <DeskSelect className="input" value={strategyNewsRiskMode} onChange={(event) => setStrategyNewsRiskMode(event.target.value as "off" | "block")}>
                            <option value="off">{tMain("strategy.newsRiskModeOff")}</option>
                            <option value="block">{tMain("strategy.newsRiskModeBlock")}</option>
                          </DeskSelect>
                        </label>
                        <label className="settingsField">
                          <span className="settingsFieldLabel">{tMain("strategy.slTpSource")}</span>
                          <DeskSelect className="input" value={strategySlTpSource} onChange={(event) => setStrategySlTpSource(event.target.value as "local" | "ai" | "hybrid")}>
                            <option value="local">{tMain("strategy.slTpSourceLocal")}</option>
                            <option value="ai">{tMain("strategy.slTpSourceAi")}</option>
                            <option value="hybrid">{tMain("strategy.slTpSourceHybrid")}</option>
                          </DeskSelect>
                        </label>
                      </div>
                    </section>
                  ) : null}

                  <section className="predictionBuilderConfigSection">
                    <div className="predictionBuilderConfigHeading">
                      <AppIcon name="filter" />
                      <div>
                        <h3>{tMain("strategy.builder.indicatorsTitle")}</h3>
                        <p>{tMain("strategy.builder.indicatorsHint")}</p>
                      </div>
                      <DeskBadge className="badge">{tMain("strategy.builder.selectedCount", { count: strategyIndicatorKeys.length })}</DeskBadge>
                    </div>
                    <div className="predictionBuilderIndicatorToolbar">
                      <label className="predictionBuilderIndicatorSearch">
                        <AppIcon name="search" />
                        <DeskInput
                          className="input"
                          type="search"
                          value={strategyIndicatorSearch}
                          onChange={(event) => setStrategyIndicatorSearch(event.target.value)}
                          placeholder={tMain("strategy.builder.indicatorSearch")}
                        />
                      </label>
                      <div className="predictionBuilderChipRow">
                        {selectedStrategyIndicators.map((item) => (
                          <DeskButton className="predictionBuilderChip predictionBuilderChipRemove" type="button" onClick={() => toggleStrategyIndicator(item.key)} key={item.key}>
                            {item.label}
                            <AppIcon name="close" />
                          </DeskButton>
                        ))}
                      </div>
                    </div>
                    <div className="predictionBuilderIndicatorGroups">
                      {groupedStrategyIndicators.length === 0 ? (
                        <div className="settingsMutedText">{tMain("strategy.builder.noIndicatorMatches")}</div>
                      ) : groupedStrategyIndicators.map(([group, items], index) => (
                        <details className="predictionBuilderIndicatorGroup" key={group} open={Boolean(strategyIndicatorSearch.trim()) || index === 0}>
                          <summary>
                            <span>{group}</span>
                            <span>
                              <DeskBadge className="badge">{items.length}</DeskBadge>
                              <AppIcon name="chevronDown" />
                            </span>
                          </summary>
                          <div className="predictionBuilderIndicatorOptions">
                            {items.map((item) => (
                              <label className={strategyIndicatorKeys.includes(item.key) ? "predictionBuilderIndicatorOption predictionBuilderIndicatorOptionActive" : "predictionBuilderIndicatorOption"} key={item.key}>
                                <DeskCheckbox checked={strategyIndicatorKeys.includes(item.key)} onCheckedChange={() => toggleStrategyIndicator(item.key)} />
                                <span>
                                  <strong>{item.label}</strong>
                                  <small>{item.description}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </section>

                  <details className="predictionBuilderAdvanced">
                    <summary>
                      <span>
                        <AppIcon name="settings" />
                        <span>
                          <strong>{tMain("strategy.builder.advancedTitle")}</strong>
                          <small>{tMain("strategy.builder.advancedHint")}</small>
                        </span>
                      </span>
                      <AppIcon name="chevronDown" />
                    </summary>
                    <label className="settingsField">
                      <span className="settingsFieldLabel">{tMain("strategy.ohlcvBars")}</span>
                      <DeskInput className="input" type="number" min={20} max={500} step={1} value={strategyOhlcvBars} onChange={(event) => setStrategyOhlcvBars(event.target.value)} />
                    </label>
                  </details>
                </main>

                <aside className="uiSection predictionBuilderOverview">
                  <div className="uiSectionHeader">
                    <div>
                      <h3>{tMain("strategy.builder.overviewTitle")}</h3>
                      <p>{strategyName || tMain("strategy.promptNamePlaceholder")}</p>
                    </div>
                    <DeskBadge className="badge">v1 · r{strategyDraftRevision}</DeskBadge>
                  </div>
                  <div className="predictionBuilderOverviewSummary">
                    <span>{strategyDescription.trim() || tMain("strategy.builder.briefEmpty")}</span>
                  </div>
                  <div className="predictionBuilderCompleteness">
                    <div>
                      <span>{tMain("strategy.builder.completeness")}</span>
                      <strong>{tMain("strategy.builder.completenessValue", { complete: strategyCompletionCount, total: strategyCompletionItems.length })}</strong>
                    </div>
                    <GlassProgress value={strategyCompletionCount} max={strategyCompletionItems.length} aria-label={tMain("strategy.builder.completeness")} />
                  </div>
                  {strategyCompletionCount < strategyCompletionItems.length ? (
                    <DeskSurface><div className="uiNotice uiNotice-warning predictionBuilderOverviewNotice">
                      <AppIcon name="alerts" />
                      <span>{tMain("strategy.builder.incompleteHint")}</span>
                    </div></DeskSurface>
                  ) : (
                    <DeskSurface><div className="uiNotice uiNotice-success predictionBuilderOverviewNotice">
                      <AppIcon name="check" />
                      <span>{tMain("strategy.builder.completeHint")}</span>
                    </div></DeskSurface>
                  )}
                  {strategyDraftValidation && strategyDraftValidation.issues.length > 0 ? (
                    <div className="settingsDraftValidationError">
                      <strong>{tMain("strategy.builder.invalidDraft")}</strong>
                      <ul>{strategyDraftValidation.issues.map((issue) => <li key={issue.path + issue.code}>{issue.message}</li>)}</ul>
                    </div>
                  ) : null}
                  <DeskButton className="btn predictionBuilderRefineButton" type="button" onClick={() => setStrategyBuilderStep(1)}>
                    <AppIcon name="ai" />
                    {tMain("strategy.builder.refineWithAi")}
                  </DeskButton>
                  <span className="settingsMutedText">{tMain("strategy.builder.updatedNow")}</span>
                </aside>
              </div>

              <footer className="predictionBuilderActionBar">
                <DeskButton className="btn" type="button" onClick={() => setStrategyBuilderStep(1)}>
                  <AppIcon name="back" />
                  {tMain("strategy.builder.backToIdea")}
                </DeskButton>
                <div className="predictionBuilderSafety">
                  <AppIcon name="shield" />
                  <span>{tMain("strategy.builder.safetyShort")}</span>
                </div>
                <DeskButton className="btn btnPrimary" type="button" disabled={strategyGenerating} onClick={() => void generateStrategyPreview()}>
                  <AppIcon name="preview" />
                  {strategyGenerating ? tMain("strategy.previewGenerating") : tMain("strategy.builder.reviewPreview")}
                </DeskButton>
              </footer>
            </>
          ) : null}

          {strategyBuilderStep === 3 ? (
            <>
              <div className="predictionBuilderReviewLayout">
                <main className="uiSection predictionBuilderReview">
                  <div className="uiSectionHeader">
                    <div>
                      <h3>{tMain("strategy.builder.reviewTitle")}</h3>
                      <p>{tMain("strategy.builder.reviewHint")}</p>
                    </div>
                  </div>

                  <div className={strategyDraftValidation?.valid === false ? "predictionBuilderValidation predictionBuilderValidationError" : "predictionBuilderValidation predictionBuilderValidationOk"} role="status">
                    <AppIcon name={strategyDraftValidation?.valid === false ? "alerts" : "check"} />
                    <div>
                      <strong>{strategyDraftValidation?.valid === false ? tMain("strategy.builder.needsWorkTitle") : tMain("strategy.builder.readyTitle")}</strong>
                      <span>{strategyDraftValidation?.valid === false ? tMain("strategy.builder.needsWorkHint") : tMain("strategy.builder.readyHint")}</span>
                    </div>
                  </div>

                  {strategyDraftValidation && strategyDraftValidation.issues.length > 0 ? (
                    <div className="settingsDraftValidationError">
                      <ul>{strategyDraftValidation.issues.map((issue) => <li key={issue.path + issue.code}>{issue.message}</li>)}</ul>
                    </div>
                  ) : null}

                  <dl className="predictionBuilderReviewList">
                    <div>
                      <dt>{tMain("strategy.builder.strategyName")}</dt>
                      <dd>{strategyName}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.strategyType")}</dt>
                      <dd>{strategyPromptMode === "market_analysis" ? tMain("strategy.promptModeAnalysis") : tMain("strategy.builder.tradingSetup")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.analysisGoal")}</dt>
                      <dd>{strategyDescription}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.marketContextTitle")}</dt>
                      <dd>
                        {strategyTimeframes.join(", ")} · {tMain("strategy.runTimeframe")}: {strategyRunTimeframe || tMain("strategy.none")} · {strategyHorizonValue} {tMain("strategy.builder." + strategyHorizonUnit)}
                      </dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.longSetup")}</dt>
                      <dd>{strategyLongRule || tMain("strategy.builder.notDefined")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.shortSetup")}</dt>
                      <dd>{strategyShortRule || tMain("strategy.builder.notDefined")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.noTradeConditions")}</dt>
                      <dd>{strategyNoTradeRule || tMain("strategy.builder.notDefined")}</dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.riskTitle")}</dt>
                      <dd>
                        {tMain("strategy.builder.invalidationLevel")}: {strategyInvalidationLevel || "—"} · {tMain("strategy.builder.targetLevels")}: {strategyTargetLevels || "—"} · {strategyConfidenceTargetPct}%
                      </dd>
                    </div>
                    <div>
                      <dt>{tMain("strategy.builder.selectedIndicators")}</dt>
                      <dd className="predictionBuilderChipRow">
                        {selectedStrategyIndicators.length > 0
                          ? selectedStrategyIndicators.map((item) => <DeskBadge className="predictionBuilderChip" key={item.key}>{item.label}</DeskBadge>)
                          : tMain("strategy.builder.noIndicators")}
                      </dd>
                    </div>
                  </dl>

                  <details className="predictionBuilderGeneratedPrompt">
                    <summary>
                      <span>
                        <AppIcon name="preview" />
                        <strong>{tMain("strategy.builder.generatedPrompt")}</strong>
                      </span>
                      <span>
                        {tMain("strategy.builder.advancedLabel")}
                        <AppIcon name="chevronDown" />
                      </span>
                    </summary>
                    <DeskTextarea className="input" rows={16} maxLength={8000} value={strategyPreviewPromptText} onChange={(event) => setStrategyPreviewPromptText(event.target.value)} />
                    {strategyPreviewMeta ? <span className="settingsMutedText">{tMain("strategy.previewHint", { mode: strategyPreviewMeta.mode, model: strategyPreviewMeta.model })}</span> : null}
                  </details>
                </main>

                <aside className="uiSection predictionBuilderSavePanel">
                  <h3>{tMain("strategy.builder.beforeSaving")}</h3>
                  <ul className="predictionBuilderChecklist">
                    <li><AppIcon name="check" /><span><strong>{tMain("strategy.builder.rulesChecked")}</strong><small>{tMain("strategy.builder.rulesCheckedHint")}</small></span></li>
                    <li><AppIcon name="check" /><span><strong>{tMain("strategy.builder.riskDefined")}</strong><small>{tMain("strategy.builder.riskDefinedHint")}</small></span></li>
                    <li><AppIcon name="check" /><span><strong>{tMain("strategy.builder.noExecution")}</strong><small>{tMain("strategy.builder.noExecutionHint")}</small></span></li>
                  </ul>
                  <dl className="predictionBuilderSaveMeta">
                    <div><dt>{tMain("strategy.builder.strategyName")}</dt><dd>{strategyName}</dd></div>
                    <div><dt>{tMain("strategy.runTimeframe")}</dt><dd>{strategyRunTimeframe || "—"}</dd></div>
                    <div><dt>{tMain("strategy.builder.horizon")}</dt><dd>{strategyHorizonValue} {tMain("strategy.builder." + strategyHorizonUnit)}</dd></div>
                    <div><dt>{tMain("strategy.builder.selectedIndicators")}</dt><dd>{strategyIndicatorKeys.length}</dd></div>
                  </dl>
                  <DeskSurface><div className="uiNotice uiNotice-info predictionBuilderSaveNotice">
                    <AppIcon name="shield" />
                    <span>{strategyPreviewSafety ? tMain("strategy.builder.previewSafetyVerified") : tMain("strategy.builder.privateTemplateNotice")}</span>
                  </div></DeskSurface>
                  <DeskButton
                    className="btn btnPrimary predictionBuilderSaveButton"
                    type="button"
                    disabled={strategySaving || !strategyPreviewPromptText.trim() || strategyDraftValidation?.valid === false}
                    onClick={() => void saveStrategyFromPreview()}
                  >
                    <AppIcon name="save" />
                    {strategySaving ? tMain("strategy.previewSaving") : strategyEditingId ? tMain("strategy.builder.confirmUpdate") : tMain("strategy.builder.saveTemplate")}
                  </DeskButton>
                  <DeskButton className="predictionBuilderTextButton" type="button" onClick={() => setStrategyBuilderStep(2)} disabled={strategySaving}>
                    {tMain("strategy.builder.backAndEdit")}
                  </DeskButton>
                  <span className="predictionBuilderDestination">
                    <AppIcon name="template" />
                    {tMain("strategy.builder.savedDestination")}
                  </span>
                  {strategyLastSavedPromptText ? (
                    <div className="predictionBuilderSavedResult" role="status">
                      <AppIcon name="check" />
                      <div>
                        <strong>{tMain("strategy.builder.savedTemplateSuccess")}</strong>
                        <span>{strategyLastSavedMeta ? tMain("strategy.resultMeta", { mode: strategyLastSavedMeta.mode, model: strategyLastSavedMeta.model }) : ""}</span>
                      </div>
                      <DeskLink className="btn" href={withLocalePath("/bots/new?review=1&strategy=prediction_copier", locale)}>
                        <AppIcon name="external" />
                        {tMain("strategy.builder.openCopierReview")}
                      </DeskLink>
                    </div>
                  ) : null}
                </aside>
              </div>

              <div className="predictionBuilderSafety predictionBuilderReviewSafety">
                <AppIcon name="shield" />
                <span>{tMain("strategy.builder.safetyShort")}</span>
              </div>
            </>
          ) : null}
        </>
      )}

      <AdminConfirmDialog
        open={Boolean(strategyDeletePendingId)}
        title={tMain("strategy.builder.deleteTitle")}
        description={tMain("strategy.messages.confirmDelete")}
        confirmLabel={tMain("actions.delete")}
        cancelLabel={tMain("actions.cancel")}
        onCancel={() => setStrategyDeletePendingId(null)}
        onConfirm={() => {
          const id = strategyDeletePendingId;
          setStrategyDeletePendingId(null);
          if (id) void deleteStrategyPrompt(id);
        }}
      />
    </div>
  );
}
