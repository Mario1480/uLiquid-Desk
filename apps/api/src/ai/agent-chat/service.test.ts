import assert from "node:assert/strict";
import test from "node:test";
import { AgentChatService } from "./service.js";

test("agent activity selects only JSON-safe fields", async () => {
  let query: any = null;
  const activity = {
    id: "run-1",
    status: "completed",
    provider: "openai",
    model: "gpt-5.6-terra",
    latencyMs: 1234,
    toolCalls: []
  };
  const service = new AgentChatService({
    db: {
      aiAgentRun: {
        findFirst: async (value: unknown) => {
          query = value;
          return activity;
        }
      }
    },
    callAiChat: async () => { throw new Error("not_used"); },
    resolvePlanCapabilitiesForUserId: async () => ({ plan: "pro", capabilities: {} as any }),
    isCapabilityAllowed: () => false,
    hasAdminAccess: async () => true
  });

  const result = await service.getActivity({ id: "user-1", email: "admin@example.com" }, "run-1");

  assert.deepEqual(result, activity);
  assert.deepEqual(query.where, { id: "run-1", userId: "user-1" });
  assert.equal(query.include, undefined);
  assert.deepEqual(Object.keys(query.select).sort(), ["id", "latencyMs", "model", "provider", "status", "toolCalls"]);
  assert.doesNotThrow(() => JSON.stringify(result));
});
