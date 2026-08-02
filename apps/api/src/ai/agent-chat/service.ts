import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import type { AiChatResult, CallAiChatOptions, ChatMessage } from "../provider.js";
import { AgentChatError } from "./errors.js";
import { assertProfileSkillsAllowed, BUILTIN_AGENT_PROFILES, resolveBuiltinAgentProfile } from "./profiles.js";
import { assertAgentChatAccess, assertProfileAccess, resolveAgentChatFeatureAccess, type AgentChatFeatureAccess } from "./policy.js";
import { runAgentChat } from "./runtime.js";
import { profileMutationSchema } from "./schemas.js";
import { listAgentSkillDescriptors } from "./skills.js";
import type { AgentProfileKey, ResolvedAgentProfile } from "./contracts.js";

type CallAiChat = (messages: ChatMessage[], options?: CallAiChatOptions) => Promise<AiChatResult>;

export type AgentChatServiceDeps = {
  db: any;
  callAiChat: CallAiChat;
  resolvePlanCapabilitiesForUserId(params: { userId: string }): Promise<{ plan: PlanTier; capabilities: PlanCapabilities }>;
  isCapabilityAllowed(capabilities: PlanCapabilities, capability: CapabilityKey): boolean;
  hasAdminAccess(user: { id: string; email: string }): Promise<boolean>;
};

const requestTimesByUser = new Map<string, number[]>();
const activeUsers = new Set<string>();

function normalizeCustomProfile(row: any): ResolvedAgentProfile {
  return {
    id: String(row.id),
    key: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    baseProfileKey: row.baseProfileKey as AgentProfileKey,
    version: Number(row.version ?? 1),
    enabledSkillIds: Array.isArray(row.enabledSkillIds) ? row.enabledSkillIds.map(String) : [],
    allowedExchangeAccountIds: Array.isArray(row.allowedExchangeAccountIds) ? row.allowedExchangeAccountIds.map(String) : [],
    preferredVenue: row.preferredVenue,
    preferredMarketType: row.preferredMarketType === "spot" || row.preferredMarketType === "perp" ? row.preferredMarketType : null,
    actionLevel: row.actionLevel,
    builtin: false
  };
}

export class AgentChatService {
  constructor(private readonly deps: AgentChatServiceDeps) {}

  async featureAccess(user: { id: string; email: string }): Promise<{ access: AgentChatFeatureAccess; plan: PlanTier }> {
    const [capabilityContext, isAdmin] = await Promise.all([
      this.deps.resolvePlanCapabilitiesForUserId({ userId: user.id }),
      this.deps.hasAdminAccess(user)
    ]);
    return {
      access: resolveAgentChatFeatureAccess({ capabilities: capabilityContext.capabilities, isAdmin, isCapabilityAllowed: this.deps.isCapabilityAllowed }),
      plan: capabilityContext.plan
    };
  }

  async resolveProfile(userId: string, profileId: string, profileKey?: string): Promise<ResolvedAgentProfile> {
    if (profileId.startsWith("builtin:")) return resolveBuiltinAgentProfile(profileId.slice("builtin:".length));
    if (!profileId && profileKey) return resolveBuiltinAgentProfile(profileKey);
    const row = await this.deps.db.aiAgentProfile.findFirst({ where: { id: profileId, userId } });
    if (!row) throw new AgentChatError("agent_chat_profile_not_found", 404);
    const profile = normalizeCustomProfile(row);
    assertProfileSkillsAllowed(profile);
    return profile;
  }

  async listProfiles(user: { id: string; email: string }) {
    const { access, plan } = await this.featureAccess(user);
    assertAgentChatAccess(access);
    const [customRows, accounts] = await Promise.all([
      access.customProfiles ? this.deps.db.aiAgentProfile.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } }) : [],
      access.accountReads ? this.deps.db.exchangeAccount.findMany({ where: { userId: user.id }, select: { id: true, exchange: true, label: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }) : []
    ]);
    return {
      featureAccess: access,
      plan,
      profiles: [...Object.values(BUILTIN_AGENT_PROFILES).filter((profile) => profile.actionLevel !== "account_read" || access.accountReads), ...customRows.map(normalizeCustomProfile)],
      skills: listAgentSkillDescriptors().map((skill) => ({ id: skill.id, title: skill.title, description: skill.description, category: skill.category, accessLevel: skill.accessLevel, sideEffect: skill.sideEffect, supportedMarketTypes: skill.supportedMarketTypes })),
      accounts
    };
  }

  async saveProfile(user: { id: string; email: string }, raw: unknown, profileId?: string) {
    const { access } = await this.featureAccess(user);
    assertAgentChatAccess(access);
    if (!access.customProfiles) throw new AgentChatError("agent_chat_feature_disabled", 403);
    const parsed = profileMutationSchema.safeParse(raw);
    if (!parsed.success) throw new AgentChatError("agent_chat_message_invalid", 400, "Invalid agent profile.");
    const input = parsed.data;
    assertProfileSkillsAllowed(input);
    if (input.actionLevel === "account_read" && !access.accountReads) throw new AgentChatError("agent_chat_feature_disabled", 403);
    if (input.allowedExchangeAccountIds.length > 0) {
      const count = await this.deps.db.exchangeAccount.count({ where: { userId: user.id, id: { in: input.allowedExchangeAccountIds } } });
      if (count !== input.allowedExchangeAccountIds.length) throw new AgentChatError("agent_chat_account_access_denied", 403);
    }
    if (profileId) {
      const existing = await this.deps.db.aiAgentProfile.findFirst({ where: { id: profileId, userId: user.id }, select: { id: true, version: true } });
      if (!existing) throw new AgentChatError("agent_chat_profile_not_found", 404);
      return normalizeCustomProfile(await this.deps.db.aiAgentProfile.update({ where: { id: existing.id }, data: { ...input, version: existing.version + 1 } }));
    }
    return normalizeCustomProfile(await this.deps.db.aiAgentProfile.create({ data: { userId: user.id, ...input } }));
  }

  async deleteProfile(user: { id: string; email: string }, profileId: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    if (!access.customProfiles) throw new AgentChatError("agent_chat_feature_disabled", 403);
    const existing = await this.deps.db.aiAgentProfile.findFirst({ where: { id: profileId, userId: user.id }, select: { id: true } });
    if (!existing) throw new AgentChatError("agent_chat_profile_not_found", 404);
    await this.deps.db.aiAgentProfile.delete({ where: { id: existing.id } });
  }

  private async validateContext(userId: string, context: any, access: AgentChatFeatureAccess): Promise<ResolvedAgentProfile> {
    const profileId = context.profileId ?? `builtin:${context.profileKey}`;
    const profile = await this.resolveProfile(userId, profileId, context.profileKey);
    assertProfileAccess(profile, access);
    if (profile.actionLevel === "account_read") {
      if (!context.selectedExchangeAccountId) throw new AgentChatError("agent_chat_account_access_denied", 403);
      const account = await this.deps.db.exchangeAccount.findFirst({ where: { id: context.selectedExchangeAccountId, userId }, select: { id: true } });
      if (!account) throw new AgentChatError("agent_chat_account_access_denied", 404);
      if (!profile.builtin && !profile.allowedExchangeAccountIds.includes(account.id)) throw new AgentChatError("agent_chat_account_access_denied", 403);
    } else if (context.selectedExchangeAccountId) {
      throw new AgentChatError("agent_chat_account_access_denied", 403);
    }
    return profile;
  }

  async listConversations(user: { id: string; email: string }, cursor?: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const rows = await this.deps.db.aiAgentConversation.findMany({ where: { userId: user.id, ...(cursor ? { lastMessageAt: { lt: new Date(cursor) } } : {}) }, orderBy: { lastMessageAt: "desc" }, take: 30 });
    return { items: rows, nextCursor: rows.length === 30 ? rows.at(-1)?.lastMessageAt?.toISOString?.() ?? null : null };
  }

  async createConversation(user: { id: string; email: string }, input: any) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const profile = await this.validateContext(user.id, input.context, access);
    return this.deps.db.aiAgentConversation.create({ data: { userId: user.id, profileId: profile.builtin ? null : profile.id, profileKey: profile.baseProfileKey, title: input.title ?? (profile.baseProfileKey === "position_copilot" ? "Position analysis" : "Market analysis"), status: "active", selectedVenue: input.context.selectedVenue, selectedExchangeAccountId: input.context.selectedExchangeAccountId, marketType: input.context.marketType, symbol: input.context.symbol ? String(input.context.symbol).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : null } });
  }

  async getConversation(user: { id: string; email: string }, id: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const conversation = await this.deps.db.aiAgentConversation.findFirst({ where: { id, userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } } });
    if (!conversation) throw new AgentChatError("agent_chat_conversation_not_found", 404);
    return conversation;
  }

  async updateConversation(user: { id: string; email: string }, id: string, patch: any) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const current = await this.deps.db.aiAgentConversation.findFirst({ where: { id, userId: user.id } });
    if (!current) throw new AgentChatError("agent_chat_conversation_not_found", 404);
    const nextContext = { profileId: patch.context?.profileId ?? current.profileId ?? `builtin:${patch.context?.profileKey ?? current.profileKey}`, profileKey: patch.context?.profileKey ?? current.profileKey, selectedVenue: patch.context?.selectedVenue ?? current.selectedVenue, selectedExchangeAccountId: patch.context?.selectedExchangeAccountId === undefined ? current.selectedExchangeAccountId : patch.context.selectedExchangeAccountId, marketType: patch.context?.marketType === undefined ? current.marketType : patch.context.marketType, symbol: patch.context?.symbol === undefined ? current.symbol : patch.context.symbol };
    const profile = await this.validateContext(user.id, nextContext, access);
    return this.deps.db.aiAgentConversation.update({ where: { id: current.id }, data: { ...(patch.title ? { title: patch.title } : {}), ...(patch.status ? { status: patch.status } : {}), ...(patch.context ? { profileId: profile.builtin ? null : profile.id, profileKey: profile.baseProfileKey, selectedVenue: nextContext.selectedVenue, selectedExchangeAccountId: nextContext.selectedExchangeAccountId, marketType: nextContext.marketType, symbol: nextContext.symbol ? String(nextContext.symbol).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : null } : {}) } });
  }

  async archiveConversation(user: { id: string; email: string }, id: string) {
    return this.updateConversation(user, id, { status: "archived" });
  }

  async sendMessage(user: { id: string; email: string }, conversationId: string, content: string, locale: "de" | "en") {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const now = Date.now(); const recent = (requestTimesByUser.get(user.id) ?? []).filter((ts) => ts > now - 60_000);
    if (recent.length >= 10) throw new AgentChatError("agent_chat_tool_budget_exceeded", 429, "Agent chat rate limit exceeded.");
    if (activeUsers.has(user.id)) throw new AgentChatError("agent_chat_run_in_progress", 409);
    recent.push(now); requestTimesByUser.set(user.id, recent); activeUsers.add(user.id);
    try {
      const conversation = await this.deps.db.aiAgentConversation.findFirst({ where: { id: conversationId, userId: user.id, status: "active" } });
      if (!conversation) throw new AgentChatError("agent_chat_conversation_not_found", 404);
      const profile = await this.validateContext(user.id, { profileId: conversation.profileId ?? `builtin:${conversation.profileKey}`, profileKey: conversation.profileKey, selectedVenue: conversation.selectedVenue, selectedExchangeAccountId: conversation.selectedExchangeAccountId, marketType: conversation.marketType, symbol: conversation.symbol }, access);
      const history = await this.deps.db.aiAgentMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 10, select: { role: true, content: true } });
      await this.deps.db.aiAgentMessage.create({ data: { conversationId: conversation.id, role: "user", content } });
      await this.deps.db.aiAgentConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      return await runAgentChat({ db: this.deps.db, callAiChat: this.deps.callAiChat, userId: user.id, conversation, profile, locale, userMessage: content, history: history.reverse() });
    } finally {
      activeUsers.delete(user.id);
    }
  }

  async getActivity(user: { id: string; email: string }, runId: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const run = await this.deps.db.aiAgentRun.findFirst({ where: { id: runId, userId: user.id }, include: { toolCalls: { orderBy: { createdAt: "asc" } } } });
    if (!run) throw new AgentChatError("agent_chat_conversation_not_found", 404);
    return run;
  }
}
