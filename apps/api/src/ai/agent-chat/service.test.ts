import assert from "node:assert/strict";
import test from "node:test";
import { AgentChatService } from "./service.js";

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
