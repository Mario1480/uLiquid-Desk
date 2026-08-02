"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "../../lib/api";
import { AppIcon } from "../../app/components/AppIcon";
import { Notice, PageHeader } from "../../app/components/ui";
import type {
  AgentActivity,
  AgentChatResponse,
  AgentContextDraft,
  AgentConversation,
  AgentMessage,
  AgentProfile,
  AgentProfilesResponse
} from "../../src/agent-chat/contracts";
import { canSendAgentMessage, enabledSkillsForProfile } from "../../src/agent-chat/viewModel";
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

function contextFromConversation(conversation: AgentConversation): AgentContextDraft {
  return {
    profileId: conversation.profileId ?? `builtin:${conversation.profileKey}`,
    profileKey: conversation.profileKey,
    selectedVenue: conversation.selectedVenue,
    selectedExchangeAccountId: conversation.selectedExchangeAccountId,
    marketType: conversation.marketType === "spot" ? "spot" : "perp",
    symbol: conversation.symbol ?? "BTCUSDT"
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
  const [activity, setActivity] = useState<AgentActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

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

  const loadConversation = useCallback(async (id: string) => {
    const conversation = await apiGet<AgentConversation>(`/api/agent-chat/conversations/${encodeURIComponent(id)}`);
    setActiveConversation(conversation);
    setMessages(conversation.messages ?? []);
    setContext(contextFromConversation(conversation));
    setActivity(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [profileData, history] = await Promise.all([
          apiGet<AgentProfilesResponse>("/api/agent-chat/profiles"),
          apiGet<{ items: AgentConversation[] }>("/api/agent-chat/conversations")
        ]);
        if (!mounted) return;
        setProfilesPayload(profileData);
        setConversations(history.items);
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
    return () => { mounted = false; };
  }, [loadConversation]);

  function newChat() {
    setActiveConversation(null);
    setMessages([]);
    setActivity(null);
    setContext(DEFAULT_CONTEXT);
    setComposer("");
    setError(null);
  }

  async function ensureConversation(): Promise<AgentConversation> {
    if (activeConversation) {
      const updated = await apiPatch<AgentConversation>(`/api/agent-chat/conversations/${encodeURIComponent(activeConversation.id)}`, { context });
      setActiveConversation(updated);
      return updated;
    }
    const created = await apiPost<AgentConversation>("/api/agent-chat/conversations", { context });
    setActiveConversation(created);
    setConversations((current) => [created, ...current]);
    return created;
  }

  async function sendMessage(contentOverride?: string) {
    const content = (contentOverride ?? composer).trim();
    if (!canSendAgentMessage({ content, loading: sending, profile: activeProfile, selectedExchangeAccountId: context.selectedExchangeAccountId })) return;
    setSending(true);
    setError(null);
    const optimistic: AgentMessage = { id: `optimistic:${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    setMessages((current) => [...current, optimistic]);
    setComposer("");
    try {
      const conversation = await ensureConversation();
      const response = await apiPost<AgentChatResponse>(`/api/agent-chat/conversations/${encodeURIComponent(conversation.id)}/messages`, { content, locale });
      const assistant: AgentMessage = { id: response.messageId, role: "assistant", content: response.content, blocks: response.blocks, sourceRefs: response.citations, createdAt: new Date().toISOString() };
      setMessages((current) => [...current.filter((message) => message.id !== optimistic.id), { ...optimistic, id: `user:${response.messageId}` }, assistant]);
      const runActivity = await apiGet<AgentActivity>(`/api/agent-chat/runs/${encodeURIComponent(response.run.id)}/activity`);
      setActivity(runActivity);
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, lastMessageAt: new Date().toISOString(), symbol: context.symbol, selectedVenue: context.selectedVenue } : item).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setComposer(content);
      setError(errorMessage(sendError));
    } finally {
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
  const sendDisabled = !canSendAgentMessage({ content: composer, loading: sending, profile: activeProfile, selectedExchangeAccountId: context.selectedExchangeAccountId });

  return (
    <main className="uiPage agentChatPage">
      <PageHeader title={t("title")} description={t("description")} actions={<><span className="badge agentChatReadOnlyBadge"><AppIcon name="shield" />{t("readOnlyMvp")}</span><button type="button" className="btn btnPrimary" onClick={newChat}><AppIcon name="create" />{t("actions.newChat")}</button></>} />
      {error ? <Notice tone="danger"><strong>{t("states.errorTitle")}</strong><span>{error}</span></Notice> : null}
      {profilesPayload && !profilesPayload.featureAccess.chat ? <Notice tone="warning"><strong>{t("states.disabledTitle")}</strong><span>{t("states.disabled")}</span></Notice> : null}
      <AgentContextBar context={context} profiles={profiles} accounts={accounts} activeProfile={activeProfile} skillCount={enabledSkills.length} disabled={sending || loading} onChange={(patch) => setContext((current) => ({ ...current, ...patch }))} onOpenSkills={() => setSkillsOpen(true)} />
      <div className="agentChatWorkspace">
        <ConversationHistory conversations={conversations} activeId={activeConversation?.id ?? null} onSelect={(id) => void loadConversation(id).catch((loadError) => setError(errorMessage(loadError)))} onNew={newChat} onArchive={(id) => void archiveConversation(id)} />
        <section className="agentChatConversation" aria-label={t("conversation.title")}>
          <div className="agentChatMessages">
            {loading ? <div className="agentChatEmpty"><span className="agentChatSpinner" /><p>{t("states.loading")}</p></div> : messages.length === 0 ? (
              <div className="agentChatEmpty"><span className="agentChatEmptyIcon"><AppIcon name="ai" /></span><h2>{t("empty.title")}</h2><p>{profileDescription ?? t("empty.description")}</p><div className="agentChatQuickPrompts">{quickPrompts.map((prompt) => <button key={prompt} className="btn" type="button" disabled={sending || (activeProfile?.actionLevel === "account_read" && !context.selectedExchangeAccountId)} onClick={() => void sendMessage(prompt)}>{prompt}</button>)}</div></div>
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
          <AgentComposer value={composer} loading={sending} disabled={sendDisabled} onChange={setComposer} onSend={() => void sendMessage()} onShowActivity={() => setActivityOpen(true)} />
        </section>
        <div className={activityOpen ? "agentChatActivityMobileOpen" : ""}><AgentActivityPanel activity={activity} loading={sending} onClose={() => setActivityOpen(false)} /></div>
      </div>
      <SkillPermissionDrawer open={skillsOpen} profile={activeProfile} skills={skills} accounts={accounts} onClose={() => setSkillsOpen(false)} />
    </main>
  );
}
