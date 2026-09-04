import type { CapabilityKey, PlanCapabilities, PlanTier } from "@mm/core";
import type { AiChatResult, CallAiChatOptions, ChatMessage } from "../provider.js";
import { redactAiSafetySecrets } from "../safety/toolPolicy.js";
import { normalizeStoredAgentMessages } from "./answer.js";
import { AgentChatError } from "./errors.js";
import { assertProfileSkillsAllowed, BUILTIN_AGENT_PROFILES, resolveBuiltinAgentProfile } from "./profiles.js";
import {
  assertAgentChatAccess,
  assertProfileAccess,
  canAccessAgentProfile,
  resolveAgentChatFeatureAccess,
  type AgentChatFeatureAccess
} from "./policy.js";
import { runAgentChat } from "./runtime.js";
import { profileMutationSchema } from "./schemas.js";
import { buildAgentChatScopeResponse, classifyAgentChatScope, filterAgentChatModelHistory, type AgentChatScopeDecision } from "./scopeGuard.js";
import { listAgentSkillDescriptors } from "./skills.js";
import { projectDecisionLogs } from "./decisionLogs.js";
import type { AgentProfileKey, ResolvedAgentProfile } from "./contracts.js";

type CallAiChat = (messages: ChatMessage[], options: CallAiChatOptions) => Promise<AiChatResult>;

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
    const visibleProfiles = [
      ...Object.values(BUILTIN_AGENT_PROFILES),
      ...customRows.map(normalizeCustomProfile)
    ].filter((profile) => canAccessAgentProfile(profile, access));
    return {
      featureAccess: access,
      plan,
      profiles: visibleProfiles,
      skills: listAgentSkillDescriptors().map((skill) => ({ id: skill.id, version: skill.version, status: skill.status, allowedProfiles: skill.allowedProfiles, outputSchemaId: skill.outputSchemaId, routineIds: skill.routineIds, title: skill.title, description: skill.description, category: skill.category, accessLevel: skill.accessLevel, sideEffect: skill.sideEffect, supportedMarketTypes: skill.supportedMarketTypes })),
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
    if (input.baseProfileKey === "position_copilot" && !access.positionCopilot) {
      throw new AgentChatError("agent_chat_feature_disabled", 403, "Position Copilot is disabled.");
    }
    if (input.actionLevel === "account_read" && !access.accountReads) throw new AgentChatError("agent_chat_feature_disabled", 403);
    if (input.allowedExchangeAccountIds.length > 1 && !access.multiExchangeAnalysis) {
      throw new AgentChatError("agent_chat_feature_disabled", 403, "Multi-exchange analysis is disabled.");
    }
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
    const rows = await this.deps.db.aiAgentConversation.findMany({ where: { userId: user.id, status: "active", ...(cursor ? { lastMessageAt: { lt: new Date(cursor) } } : {}) }, orderBy: { lastMessageAt: "desc" }, take: 30 });
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
    return { ...conversation, messages: normalizeStoredAgentMessages(conversation.messages ?? []) };
  }

  async listDecisionLogs(user: { id: string; email: string }, conversationId: string, requestedLimit?: number) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const conversation = await this.deps.db.aiAgentConversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: { id: true }
    });
    if (!conversation) throw new AgentChatError("agent_chat_conversation_not_found", 404);
    const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit as number) : 20));
    const [runs, messages] = await Promise.all([
      this.deps.db.aiAgentRun.findMany({
        where: { conversationId, userId: user.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true, status: true, profileSnapshot: true, contextSnapshot: true, modelClass: true,
          latencyMs: true, errorCode: true, createdAt: true, completedAt: true,
          traceLogs: { orderBy: { createdAt: "desc" }, take: 3, select: { parsedResponse: true } },
          toolCalls: { orderBy: { createdAt: "asc" }, select: { id: true, toolName: true, status: true, venue: true, durationMs: true, errorCode: true, resultSummary: true } }
        }
      }),
      this.deps.db.aiAgentMessage.findMany({
        where: { conversationId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        take: Math.min(100, limit * 3),
        select: { id: true, role: true, content: true, blocks: true, createdAt: true }
      })
    ]);
    return { items: projectDecisionLogs(runs, messages) };
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

  private async completeScopeGuardResponse(params: {
    userId: string;
    conversation: any;
    profile: ResolvedAgentProfile;
    locale: "de" | "en";
    idempotencyKey: string;
    decision: Exclude<AgentChatScopeDecision, "in_scope">;
  }) {
    const startedAt = Date.now();
    const content = buildAgentChatScopeResponse({
      decision: params.decision,
      locale: params.locale,
      profileKey: params.profile.baseProfileKey
    });
    const run = await this.deps.db.aiAgentRun.create({
      data: {
        conversationId: params.conversation.id,
        userId: params.userId,
        scope: params.profile.actionLevel === "account_read" ? "agent_position" : "agent_market",
        status: "running",
        profileSnapshot: redactAiSafetySecrets(params.profile),
        contextSnapshot: redactAiSafetySecrets({
          profileKey: params.conversation.profileKey,
          selectedVenue: params.conversation.selectedVenue,
          selectedExchangeAccountId: params.conversation.selectedExchangeAccountId,
          marketType: params.conversation.marketType,
          symbol: params.conversation.symbol,
          locale: params.locale
        }),
        modelClass: "utility",
        routingDecision: { reasonCode: "agent_chat_scope_guard", decision: params.decision },
        idempotencyKey: params.idempotencyKey
      }
    });
    try {
      const latencyMs = Date.now() - startedAt;
      const assistantMessage = await this.deps.db.$transaction(async (tx: any) => {
        const message = await tx.aiAgentMessage.create({
          data: {
            conversationId: params.conversation.id,
            role: "assistant",
            content,
            blocks: [],
            sourceRefs: []
          }
        });
        await tx.aiAgentRun.update({
          where: { id: run.id },
          data: { status: "completed", latencyMs, completedAt: new Date() }
        });
        await tx.aiTraceLog.create({
          data: {
            agentRunId: run.id,
            userId: params.userId,
            scope: "agent_chat",
            symbol: params.conversation.symbol,
            marketType: params.conversation.marketType,
            userPayload: { conversationId: params.conversation.id, profileKey: params.profile.baseProfileKey },
            parsedResponse: { runId: run.id, assistantMessageId: message.id, profileVersion: params.profile.version, toolCalls: 0, degraded: false },
            success: true,
            fallbackUsed: false,
            latencyMs
          }
        });
        return message;
      });
      const subscription = await this.deps.db.userSubscription.findUnique({
        where: { userId: params.userId },
        select: { aiCreditBalance: true }
      }).catch(() => null);
      return {
        messageId: assistantMessage.id,
        content,
        blocks: [],
        citations: [],
        run: {
          id: run.id,
          modelClass: "utility",
          toolIterations: 0,
          toolCalls: 0,
          latencyMs,
          degraded: false,
          chargedCredits: "0",
          remainingCredits: subscription ? String(subscription.aiCreditBalance ?? 0) : null,
          skillCategories: []
        }
      };
    } catch (error) {
      await this.deps.db.aiAgentRun.update({
        where: { id: run.id },
        data: { status: "failed", errorCode: "agent_chat_scope_response_failed", completedAt: new Date() }
      }).catch(() => undefined);
      throw error;
    }
  }

  async sendMessage(user: { id: string; email: string }, conversationId: string, content: string, locale: "de" | "en", idempotencyKey: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const existingRun = await this.deps.db.aiAgentRun.findUnique({ where: { idempotencyKey } });
    if (existingRun) {
      if (existingRun.userId !== user.id || existingRun.conversationId !== conversationId) {
        throw new AgentChatError("agent_chat_message_invalid", 409, "Idempotency key already belongs to another request.");
      }
      if (existingRun.status !== "completed") {
        throw new AgentChatError("agent_chat_run_in_progress", 409);
      }
      const existingMessage = await this.deps.db.aiAgentMessage.findFirst({
        where: { conversationId, role: "assistant", createdAt: { gte: existingRun.createdAt } },
        orderBy: { createdAt: "asc" }
      });
      if (!existingMessage) throw new AgentChatError("agent_chat_run_in_progress", 409);
      const subscription = await this.deps.db.userSubscription.findUnique({ where: { userId: user.id }, select: { aiCreditBalance: true } });
      return {
        messageId: existingMessage.id,
        content: existingMessage.content,
        blocks: existingMessage.blocks ?? [],
        citations: existingMessage.sourceRefs ?? [],
        run: {
          id: existingRun.id,
          modelClass: existingRun.modelClass ?? "standard",
          toolIterations: existingRun.toolIterations,
          toolCalls: existingRun.toolCallCount,
          latencyMs: existingRun.latencyMs ?? 0,
          degraded: false,
          chargedCredits: String(existingRun.chargedCredits ?? 0),
          remainingCredits: subscription ? String(subscription.aiCreditBalance ?? 0) : null,
          skillCategories: []
        }
      };
    }
    const now = Date.now(); const recent = (requestTimesByUser.get(user.id) ?? []).filter((ts) => ts > now - 60_000);
    if (recent.length >= 10) throw new AgentChatError("agent_chat_tool_budget_exceeded", 429, "Agent chat rate limit exceeded.");
    if (activeUsers.has(user.id)) throw new AgentChatError("agent_chat_run_in_progress", 409);
    recent.push(now); requestTimesByUser.set(user.id, recent); activeUsers.add(user.id);
    try {
      const conversation = await this.deps.db.aiAgentConversation.findFirst({ where: { id: conversationId, userId: user.id, status: "active" } });
      if (!conversation) throw new AgentChatError("agent_chat_conversation_not_found", 404);
      const profile = await this.validateContext(user.id, { profileId: conversation.profileId ?? `builtin:${conversation.profileKey}`, profileKey: conversation.profileKey, selectedVenue: conversation.selectedVenue, selectedExchangeAccountId: conversation.selectedExchangeAccountId, marketType: conversation.marketType, symbol: conversation.symbol }, access);
      const history = await this.deps.db.aiAgentMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 10, select: { role: true, content: true } });
      const orderedHistory = history.reverse();
      const scopeDecision = classifyAgentChatScope({ message: content, profileKey: profile.baseProfileKey, history: orderedHistory });
      const modelHistory = filterAgentChatModelHistory(orderedHistory, profile.baseProfileKey);
      await this.deps.db.aiAgentMessage.create({ data: { conversationId: conversation.id, role: "user", content } });
      await this.deps.db.aiAgentConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      if (scopeDecision !== "in_scope") {
        return await this.completeScopeGuardResponse({
          userId: user.id,
          conversation,
          profile,
          locale,
          idempotencyKey,
          decision: scopeDecision
        });
      }
      return await runAgentChat({ db: this.deps.db, callAiChat: this.deps.callAiChat, userId: user.id, conversation, profile, locale, userMessage: content, idempotencyKey, history: modelHistory });
    } finally {
      activeUsers.delete(user.id);
    }
  }

  async getActivity(user: { id: string; email: string }, runId: string) {
    const { access } = await this.featureAccess(user); assertAgentChatAccess(access);
    const run = await this.deps.db.aiAgentRun.findFirst({
      where: { id: runId, userId: user.id },
      select: {
        id: true,
        status: true,
        latencyMs: true,
        toolCalls: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            toolName: true,
            status: true,
            venue: true,
            durationMs: true,
            resultSummary: true
          }
        }
      }
    });
    if (!run) throw new AgentChatError("agent_chat_conversation_not_found", 404);
    return run;
  }
}
