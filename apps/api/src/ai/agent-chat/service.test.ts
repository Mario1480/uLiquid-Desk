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

test("off-topic requests return a persisted zero-credit response without calling the model", async () => {
  await withAgentFeatureFlags(async () => {
    let modelCalled = false;
    const createdMessages: any[] = [];
    const createdRuns: any[] = [];
    const updatedRuns: any[] = [];
    const conversation = {
      id: "conversation-1",
      userId: "user-1",
      profileId: null,
      profileKey: "market_analyst",
      selectedVenue: "auto",
      selectedExchangeAccountId: null,
      marketType: "perp",
      symbol: "BTCUSDT",
      status: "active"
    };
    const service = new AgentChatService({
      db: {
        $transaction: async (callback: any) => callback({
          aiAgentMessage: {
            create: async ({ data }: any) => {
              createdMessages.push(data);
              return { id: `message-${createdMessages.length}`, ...data };
            }
          },
          aiAgentRun: {
            update: async ({ data }: any) => {
              updatedRuns.push(data);
              return { id: "run-guarded", ...data };
            }
          },
          aiTraceLog: {
            create: async () => ({ id: "trace-guarded" })
          }
        }),
        aiAgentRun: {
          findUnique: async () => null,
          create: async ({ data }: any) => {
            createdRuns.push(data);
            return { id: "run-guarded", ...data, createdAt: new Date() };
          },
          update: async ({ data }: any) => {
            updatedRuns.push(data);
            return { id: "run-guarded", ...data };
          }
        },
        aiAgentConversation: {
          findFirst: async () => conversation,
          update: async () => conversation
        },
        aiAgentMessage: {
          findMany: async () => [],
          create: async ({ data }: any) => {
            createdMessages.push(data);
            return { id: `message-${createdMessages.length}`, ...data };
          }
        },
        userSubscription: {
          findUnique: async () => ({ aiCreditBalance: 9916n })
        }
      },
      callAiChat: async () => {
        modelCalled = true;
        throw new Error("model_must_not_run");
      },
      resolvePlanCapabilitiesForUserId: async () => ({
        plan: "pro",
        capabilities: { "product.ai_agent_chat": true } as any
      }),
      isCapabilityAllowed: (capabilities, capability) => capabilities[capability] === true,
      hasAdminAccess: async () => false
    });

    const response = await service.sendMessage(
      { id: "user-1", email: "user@example.com" },
      conversation.id,
      "Kannst du mir eine Webseite bauen?",
      "de",
      "92e8eec3-6085-4c21-9190-d9b7c8555c23"
    );

    assert.equal(modelCalled, false);
    assert.equal(response.run.modelClass, "utility");
    assert.equal(response.run.chargedCredits, "0");
    assert.equal(response.run.remainingCredits, "9916");
    assert.equal(response.run.toolCalls, 0);
    assert.match(response.content, /Market Analyst/);
    assert.deepEqual(createdMessages.map((row) => row.role), ["user", "assistant"]);
    assert.equal(createdRuns.length, 1);
    assert.equal(createdRuns[0].status, "running");
    assert.equal(createdRuns[0].routingDecision.reasonCode, "agent_chat_scope_guard");
    assert.equal(createdRuns[0].routingDecision.decision, "out_of_scope");
    assert.equal(updatedRuns.at(-1)?.status, "completed");
  });
});

test("decision logs enforce conversation ownership and expose only projected fields", async () => {
  let owner = "user-1";
  let runTake = 0;
  const service = new AgentChatService({
    db: {
      aiAgentConversation: { findFirst: async ({ where }: any) => where.userId === owner ? { id: where.id } : null },
      aiAgentRun: { findMany: async ({ take }: any) => { runTake = take; return [{ id: "run-1", status: "failed", createdAt: new Date("2026-09-04T10:00:00Z"), completedAt: new Date("2026-09-04T10:00:01Z"), profileSnapshot: { name: "Market Analyst", baseProfileKey: "market_analyst", version: 2 }, contextSnapshot: { symbol: "BTCUSDT", marketType: "perp", selectedVenue: "auto", selectedExchangeAccountId: "secret-account" }, modelClass: "analysis", latencyMs: 1000, errorCode: "provider_failed", traceLogs: [], toolCalls: [] }]; } },
      aiAgentMessage: { findMany: async () => [] }
    },
    callAiChat: async () => { throw new Error("not_used"); },
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: {} as any }),
    isCapabilityAllowed: () => false,
    hasAdminAccess: async () => true
  });
  const result = await service.listDecisionLogs({ id: "user-1", email: "admin@example.com" }, "conversation-1", 999);
  assert.equal(runTake, 50);
  assert.equal(result.items[0]?.recommendation, null);
  assert.equal(JSON.stringify(result).includes("secret-account"), false);
  await service.listDecisionLogs({ id: "user-1", email: "admin@example.com" }, "conversation-1");
  assert.equal(runTake, 20);
  owner = "someone-else";
  await assert.rejects(() => service.listDecisionLogs({ id: "user-1", email: "admin@example.com" }, "conversation-1"), /agent_chat_conversation_not_found/);
});
