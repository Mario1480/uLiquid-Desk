import test from "node:test";
import assert from "node:assert/strict";
import { BotVaultCommandQueue } from "./botVaultCommandQueue.js";

test("BotVaultCommandQueue serializes async tasks", async () => {
  const queue = new BotVaultCommandQueue();
  const events: string[] = [];

  await Promise.all([
    queue.enqueue(async () => {
      events.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push("a:end");
    }),
    queue.enqueue(async () => {
      events.push("b:start");
      events.push("b:end");
    })
  ]);

  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});
