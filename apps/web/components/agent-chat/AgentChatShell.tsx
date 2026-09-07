"use client";
import { DeskBadge } from "@/components/desk/DeskBadge";

import { DeskButton } from "@/components/desk/DeskButton";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";
import { Notice, PageHeader } from "../../app/components/ui";
import type {
  AgentChatResponse,
  AgentContextDraft,
  AgentConversation,
  AgentDecisionLog,
  AgentMessage,
  AgentProfile,
  AgentProfilesResponse,
  AgentSkill
} from "../../src/agent-chat/contracts";
import { canSendAgentMessage, enabledSkillsForProfile, requiresSelectedExchangeAccount } from "../../src/agent-chat/viewModel";
import AgentActivityPanel from "./AgentActivityPanel";
import AgentComposer from "./AgentComposer";
import AgentContextBar from "./AgentContextBar";
import AgentMessageBlocks from "./AgentMessageBlocks";
import ConversationHistory from "./ConversationHistory";
import SkillPermissionDrawer from "./SkillPermissionDrawer";

const DEFAULT_CONTEXT: AgentContextDraft = {
  profileId: "builtin:market_analyst",
  profileKey: "market_analyst",
  selectedVenue: "auto",
  selectedExchangeAccountId: null,
  marketType: "perp",
  symbol: "BTCUSDT"
};

export const AGENT_CHAT_POSITION_PREFILL_KEY = "uliquid.agentChat.positionPrefill.v1";

type AiCreditSummary = {
  available: string;
  reserved: string;
  warningLevel: "none" | "low_20" | "low_10" | "exhausted";
};

function contextFromConversation(conversation: AgentConversation): AgentContextDraft {
  return {
    profileId: conversation.profileId ?? `builtin:${conversation.profileKey}`,
    profileKey: conversation.profileKey,
    selectedVenue: conversation.selectedVenue,
    selectedExchangeAccountId: conversation.selectedExchangeAccountId,
    marketType: conversation.marketType === "spot" ? "spot" : "perp",
    symbol: conversation.symbol ?? (conversation.profileKey === "market_analyst" ? "BTCUSDT" : null)
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return String(error.payload?.message ?? error.payload?.error ?? error.message);
  return error instanceof Error ? error.message : String(error);
}

export default function AgentChatShell() {
  const t = useTranslations("agentChat");
  const locale = useLocale() === "de" ? "de" : "en";
  const [profilesPayload, setProfilesPayload] = useState<AgentProfilesResponse | null>(null);
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<AgentConversation | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [context, setContext] = useState<AgentContextDraft>(DEFAULT_CONTEXT);
  const [composer, setComposer] = useState("");
  const [decisionLogs, setDecisionLogs] = useState<AgentDecisionLog[]>([]);
  const [decisionLogsLoading, setDecisionLogsLoading] = useState(false);
  const [decisionLogsError, setDecisionLogsError] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const conversationRequest = useRef(0);
  const visibleConversationId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [creditSummary, setCreditSummary] = useState<AiCreditSummary | null>(null);
  const [lastModelClass, setLastModelClass] = useState<string | null>(null);
  const [lastRunReceipt, setLastRunReceipt] = useState<{ chargedCredits: string; remainingCredits: string | null; skillCategories: AgentSkill["category"][] } | null>(null);

  const profiles = profilesPayload?.profiles ?? [];
  const skills = profilesPayload?.skills ?? [];
  const accounts = profilesPayload?.accounts ?? [];
  const activeProfile = useMemo(() => profiles.find((profile) => profile.id === context.profileId) ?? null, [context.profileId, profiles]);
  const enabledSkills = useMemo(() => enabledSkillsForProfile(activeProfile, skills), [activeProfile, skills]);
  const profileDescription = activeProfile?.builtin
    ? activeProfile.baseProfileKey === "position_copilot"
      ? t("profiles.positionCopilotDescription")
      : t("profiles.marketAnalystDescription")
    : activeProfile?.description;

  const refreshDecisionLogs = useCallback(async (id: string) => {
    const request = conversationRequest.current;
    setDecisionLogsLoading(true);
    setDecisionLogsError(false);
    try {
      const payload = await apiGet<{ items: AgentDecisionLog[] }>(`/api/agent-chat/conversations/${encodeURIComponent(id)}/decision-logs?limit=20`);
      if (request === conversationRequest.current && visibleConversationId.current === id) setDecisionLogs(payload.items);
    } catch {
      if (request === conversationRequest.current && visibleConversationId.current === id) setDecisionLogsError(true);
    } finally {
      if (request === conversationRequest.current && visibleConversationId.current === id) setDecisionLogsLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const request = ++conversationRequest.current;
    setConversationLoading(true);
    setDecisionLogs([]);
    setDecisionLogsError(false);
    setDecisionLogsLoading(true);
    const conversation = await apiGet<AgentConversation>(`/api/agent-chat/conversations/${encodeURIComponent(id)}`).catch(error => {
      if (request === conversationRequest.current) { setDecisionLogsLoading(false); setConversationLoading(false); }
      throw error;
    });
    if (request !== conversationRequest.current) return;
    setConversationLoading(false);
    visibleConversationId.current = id;
    setActiveConversation(conversation);
    setMessages(conversation.messages ?? []);
    setContext(contextFromConversation(conversation));
    await refreshDecisionLogs(id);
  }, [refreshDecisionLogs]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [profileData, history, credits] = await Promise.all([
          apiGet<AgentProfilesResponse>("/api/agent-chat/profiles"),
          apiGet<{ items: AgentConversation[] }>("/api/agent-chat/conversations"),
          apiGet<AiCreditSummary>("/api/billing/ai-credits").catch(() => null)
        ]);
        if (!mounted) return;
        setProfilesPayload(profileData);
        setConversations(history.items);
        setCreditSummary(credits);
        let prefill: Partial<AgentContextDraft> | null = null;
        try {
          const raw = window.sessionStorage.getItem(AGENT_CHAT_POSITION_PREFILL_KEY);
          if (raw) { prefill = JSON.parse(raw) as Partial<AgentContextDraft>; window.sessionStorage.removeItem(AGENT_CHAT_POSITION_PREFILL_KEY); }
        } catch {
          prefill = null;
        }
        if (prefill) {
          setContext({ ...DEFAULT_CONTEXT, ...prefill, profileId: "builtin:position_copilot", profileKey: "position_copilot" });
        } else if (history.items[0]) {
          await loadConversation(history.items[0].id);
        }
      } catch (loadError) {
        if (mounted) setError(errorMessage(loadError));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; conversationRequest.current++; };
  }, [loadConversation]);

  function newChat() {
    if (sending) return;
    conversationRequest.current++;
    visibleConversationId.current = null;
    setActiveConversation(null);
    setMessages([]);
    setDecisionLogs([]);
    setDecisionLogsLoading(false);
    setDecisionLogsError(false);
    setConversationLoading(false);
    setContext(DEFAULT_CONTEXT);
    setComposer("");
    setError(null);
    setLastRunReceipt(null);
  }

  async function ensureConversation(): Promise<AgentConversation> {
    if (activeConversation) {
      const updated = await apiPatch<AgentConversation>(`/api/agent-chat/conversations/${encodeURIComponent(activeConversation.id)}`, { context });
      setActiveConversation(updated);
      return updated;
    }
    const created = await apiPost<AgentConversation>("/api/agent-chat/conversations", { context });
    visibleConversationId.current = created.id;
    setActiveConversation(created);
    setConversations((current) => [created, ...current]);
    return created;
  }

  async function sendMessage(contentOverride?: string) {
    const content = (contentOverride ?? composer).trim();
    if (!canSendAgentMessage({ content, loading: sending || conversationLoading || loading, profile: activeProfile, selectedExchangeAccountId: context.selectedExchangeAccountId })) return;
    setSending(true);
    setError(null);
    const optimistic: AgentMessage = { id: `optimistic:${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    setComposer("");
    let runConversationId: string | null = null;
    try {
      const conversation = await ensureConversation();
      runConversationId = conversation.id;
      const response = await apiPost<AgentChatResponse>(`/api/agent-chat/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        content,
        locale,
        idempotencyKey: crypto.randomUUID()
      });
      const assistant: AgentMessage = { id: response.messageId, role: "assistant", content: response.content, blocks: response.blocks, sourceRefs: response.citations, createdAt: new Date().toISOString() };
      setMessages((current) => [...current.filter((message) => message.id !== optimistic.id), { ...optimistic, id: `user:${response.messageId}` }, assistant]);
      setLastModelClass(response.run.modelClass);
      setLastRunReceipt({ chargedCredits: response.run.chargedCredits, remainingCredits: response.run.remainingCredits, skillCategories: response.run.skillCategories });
      if (response.run.remainingCredits !== null) {
        setCreditSummary((current) => current ? { ...current, available: response.run.remainingCredits as string } : current);
      }
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, lastMessageAt: new Date().toISOString(), symbol: context.symbol, selectedVenue: context.selectedVenue } : item).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setComposer(content);
      setError(errorMessage(sendError));
    } finally {
      if (runConversationId) await refreshDecisionLogs(runConversationId);
      setSending(false);
    }
  }

  async function archiveConversation(id: string) {
    try {
      await apiDelete(`/api/agent-chat/conversations/${encodeURIComponent(id)}`);
      setConversations((current) => current.filter((item) => item.id !== id));
      if (activeConversation?.id === id) newChat();
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  }

  const quickPrompts = activeProfile?.baseProfileKey === "position_copilot"
    ? [t("empty.positionPrompt1"), t("empty.positionPrompt2"), t("empty.positionPrompt3")]
    : [t("empty.marketPrompt1"), t("empty.marketPrompt2"), t("empty.marketPrompt3")];
  const sendDisabled = !canSendAgentMessage({ content: composer, loading: sending || conversationLoading || loading, profile: activeProfile, selectedExchangeAccountId: context.selectedExchangeAccountId });
  const accountSelectionRequired = requiresSelectedExchangeAccount(activeProfile, context.selectedExchangeAccountId);
  const sendDisabledReason = accountSelectionRequired
    ? accounts.length > 0
      ? t("composer.selectAccountToSend")
      : t("composer.connectAccountToSend")
    : null;

  return (
    <main className="uiPage agentChatPage">
      <PageHeader title={t("title")} description={t("description")} actions={<><DeskBadge className={`badge agentChatCreditBadge agentChatCreditBadge-${creditSummary?.warningLevel ?? "none"}`}><AppIcon name="billing" />{t("credits.available", { value: creditSummary?.available ?? "-" })}</DeskBadge>{lastModelClass ? <DeskBadge className="badge agentChatAnalysisBadge">{t(`credits.classes.${lastModelClass}`)}</DeskBadge> : null}<DeskBadge className="badge agentChatReadOnlyBadge"><AppIcon name="shield" />{t("readOnlyMvp")}</DeskBadge><DeskButton type="button" className="btn btnPrimary" onClick={newChat}><AppIcon name="create" />{t("actions.newChat")}</DeskButton></>} />
      {lastRunReceipt ? (
        <div className="agentChatRunReceipt" role="status">
          <span><strong>{t("credits.lastRun")}</strong> {t("credits.charged", { value: lastRunReceipt.chargedCredits })}</span>
          <span>{t("credits.remaining", { value: lastRunReceipt.remainingCredits ?? "-" })}</span>
          {lastRunReceipt.skillCategories.length > 0 ? <span>{t("credits.usedSkills")}: {lastRunReceipt.skillCategories.map((category) => t(`credits.skillCategories.${category}`)).join(", ")}</span> : null}
        </div>
      ) : null}
      {error ? <Notice tone="danger"><strong>{t("states.errorTitle")}</strong><span>{error}</span></Notice> : null}
      {profilesPayload && !profilesPayload.featureAccess.chat ? <Notice tone="warning"><strong>{t("states.disabledTitle")}</strong><span>{t("states.disabled")}</span></Notice> : null}
      <AgentContextBar context={context} profiles={profiles} accounts={accounts} activeProfile={activeProfile} skillCount={enabledSkills.length} disabled={sending || loading} onChange={(patch) => setContext((current) => ({ ...current, ...patch }))} onOpenSkills={() => setSkillsOpen(true)} />
      <div className="agentChatWorkspace">
        <ConversationHistory conversations={conversations} activeId={activeConversation?.id ?? null} onSelect={(id) => { if (!sending) void loadConversation(id).catch((loadError) => setError(errorMessage(loadError))); }} onNew={newChat} onArchive={(id) => { if (!sending) void archiveConversation(id); }} />
        <section className="agentChatConversation" aria-label={t("conversation.title")}>
          <div className="agentChatMessages">
            {loading ? <div className="agentChatEmpty"><span className="agentChatSpinner" /><p>{t("states.loading")}</p></div> : messages.length === 0 ? (
              <div className="agentChatEmpty"><span className="agentChatEmptyIcon"><AppIcon name="ai" /></span><h2>{t("empty.title")}</h2><p>{profileDescription ?? t("empty.description")}</p><div className="agentChatQuickPrompts">{quickPrompts.map((prompt) => <DeskButton key={prompt} className="btn" type="button" disabled={sending || (activeProfile?.actionLevel === "account_read" && !context.selectedExchangeAccountId)} onClick={() => void sendMessage(prompt)}>{prompt}</DeskButton>)}</div></div>
            ) : messages.map((message) => (
              <article key={message.id} className={`agentChatMessage agentChatMessage-${message.role}`}>
                <div className="agentChatMessageMeta"><span>{message.role === "assistant" ? activeProfile?.name ?? t("assistant") : t("you")}</span><time>{new Date(message.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></div>
                <div className="agentChatMessageContent">{message.content}</div>
                {message.blocks ? <AgentMessageBlocks blocks={message.blocks} /> : null}
                {message.sourceRefs && message.sourceRefs.length > 0 ? <details className="agentChatCitations"><summary>{t("sources", { count: message.sourceRefs.length })}</summary><ul>{message.sourceRefs.map((source) => <li key={source.id}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}<small>{source.provider}{source.stale ? ` · ${t("states.stale")}` : ""}{source.degraded ? ` · ${t("states.degraded")}` : ""}</small></li>)}</ul></details> : null}
              </article>
            ))}
            {sending ? <div className="agentChatThinking" aria-live="polite"><span className="agentChatSpinner" />{t("states.analyzing")}</div> : null}
          </div>
          <AgentComposer value={composer} loading={sending} disabled={sendDisabled} disabledReason={sendDisabledReason} onChange={setComposer} onSend={() => void sendMessage()} onShowActivity={() => setActivityOpen(true)} />
        </section>
        <div className={activityOpen ? "agentChatActivityMobileOpen" : ""}><AgentActivityPanel logs={decisionLogs} loading={sending || decisionLogsLoading} error={decisionLogsError} onClose={() => setActivityOpen(false)} /></div>
      </div>
      <SkillPermissionDrawer open={skillsOpen} profile={activeProfile} skills={skills} accounts={accounts} onClose={() => setSkillsOpen(false)} />
    </main>
  );
}
