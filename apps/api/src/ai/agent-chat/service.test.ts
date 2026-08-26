import assert from "node:assert/strict";
import test from "node:test";
import { AgentChatService } from "./service.js";

async function withAgentFeatureFlags(work: () => Promise<void>) {
  const values = {
    AI_AGENT_CHAT_ENABLED: "true",
    AI_MODEL_ROUTER_V1: "true",
    AI_RESPONSES_API_AGENT: "true",
    AI_AGENT_ACCOUNT_READS_ENABLED: "true",
    AI_AGENT_CUSTOM_PROFILES_ENABLED: "true",
    AI_POSITION_COPILOT_ENABLED: "true"
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Pro profile discovery exposes Market Analyst but not private or custom profiles", async () => {
  await withAgentFeatureFlags(async () => {
    let customProfilesRead = false;
    let accountsRead = false;
    const service = new AgentChatService({
      db: {
        aiAgentProfile: {
          findMany: async () => {
            customProfilesRead = true;
            return [];
          }
        },
        exchangeAccount: {
          findMany: async () => {
            accountsRead = true;
            return [];
          }
        }
      },
      callAiChat: async () => { throw new Error("not_used"); },
      resolvePlanCapabilitiesForUserId: async () => ({
        plan: "pro",
        capabilities: { "product.ai_agent_chat": true } as any
      }),
      isCapabilityAllowed: (capabilities, capability) => capabilities[capability] === true,
      hasAdminAccess: async () => false
    });

    const result = await service.listProfiles({ id: "user-1", email: "pro@example.com" });

    assert.deepEqual(result.profiles.map((profile) => profile.id), ["builtin:market_analyst"]);
    assert.equal(result.featureAccess.positionCopilot, false);
    assert.equal(result.featureAccess.accountReads, false);
    assert.equal(customProfilesRead, false);
    assert.equal(accountsRead, false);
  });
});

test("Premium profile discovery exposes Position Copilot only when private capabilities are present", async () => {
  await withAgentFeatureFlags(async () => {
    const service = new AgentChatService({
      db: {
        aiAgentProfile: { findMany: async () => [] },
        exchangeAccount: { findMany: async () => [] }
      },
      callAiChat: async () => { throw new Error("not_used"); },
      resolvePlanCapabilitiesForUserId: async () => ({
        plan: "premium",
        capabilities: {
          "product.ai_agent_chat": true,
          "product.ai_agent_account_reads": true,
          "product.ai_agent_custom_profiles": true,
          "product.ai_position_copilot": true
        } as any
      }),
      isCapabilityAllowed: (capabilities, capability) => capabilities[capability] === true,
      hasAdminAccess: async () => false
    });

    const result = await service.listProfiles({ id: "user-1", email: "premium@example.com" });

    assert.deepEqual(result.profiles.map((profile) => profile.id), [
      "builtin:market_analyst",
      "builtin:position_copilot"
    ]);
    assert.equal(result.featureAccess.positionCopilot, true);
    assert.equal(result.featureAccess.accountReads, true);
  });
});

test("conversation history excludes archived conversations", async () => {
  let query: any = null;
  const rows = [{ id: "conversation-active", status: "active", lastMessageAt: new Date("2026-08-03T13:30:00.000Z") }];
  const service = new AgentChatService({
    db: {
      aiAgentConversation: {
        findMany: async (value: unknown) => {
          query = value;
          return rows;
        }
      }
    },
    callAiChat: async () => { throw new Error("not_used"); },
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: {} as any }),
    isCapabilityAllowed: () => false,
    hasAdminAccess: async () => true
  });

  const result = await service.listConversations(
    { id: "user-1", email: "admin@example.com" },
    "2026-08-03T14:00:00.000Z"
  );

  assert.deepEqual(result, { items: rows, nextCursor: null });
  assert.deepEqual(query.where, {
    userId: "user-1",
    status: "active",
    lastMessageAt: { lt: new Date("2026-08-03T14:00:00.000Z") }
  });
  assert.deepEqual(query.orderBy, { lastMessageAt: "desc" });
  assert.equal(query.take, 30);
});

test("agent activity selects only JSON-safe fields", async () => {
  let query: any = null;
  const storedActivity = {
    id: "run-1",
    status: "completed",
    provider: "openai",
    model: "gpt-5.6-terra",
    latencyMs: 1234,
    toolCalls: []
  };
  const publicActivity = {
    id: storedActivity.id,
    status: storedActivity.status,
    latencyMs: storedActivity.latencyMs,
    toolCalls: storedActivity.toolCalls
  };
  const service = new AgentChatService({
    db: {
      aiAgentRun: {
        findFirst: async (value: unknown) => {
          query = value;
          return publicActivity;
        }
      }
    },
    callAiChat: async () => { throw new Error("not_used"); },
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: {} as any }),
    isCapabilityAllowed: () => false,
    hasAdminAccess: async () => true
  });

  const result = await service.getActivity({ id: "user-1", email: "admin@example.com" }, "run-1");

  assert.deepEqual(result, publicActivity);
  assert.deepEqual(query.where, { id: "run-1", userId: "user-1" });
  assert.equal(query.include, undefined);
  assert.deepEqual(Object.keys(query.select).sort(), ["id", "latencyMs", "status", "toolCalls"]);
  assert.equal("model" in result, false);
  assert.equal("provider" in result, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});
