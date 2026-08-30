import assert from "node:assert/strict";
import test from "node:test";
import { buildRunnerHeartbeatPersistence } from "./runnerHeartbeat.js";

test("runner heartbeat updates both runtime and admin runner records", () => {
  const now = new Date("2026-08-30T10:54:08.025Z");
  const persistence = buildRunnerHeartbeatPersistence({
    botsRunning: 2,
    botsErrored: 1,
    workerId: "runner-host:1234",
    version: "2.0.0",
    region: "eu-central"
  }, now);

  assert.deepEqual(persistence.runnerStatus, {
    where: { id: "main" },
    update: {
      lastTickAt: now,
      botsRunning: 2,
      botsErrored: 1,
      version: "2.0.0"
    },
    create: {
      id: "main",
      lastTickAt: now,
      botsRunning: 2,
      botsErrored: 1,
      version: "2.0.0"
    }
  });
  assert.deepEqual(persistence.runnerNode.update, {
    name: "Main runner",
    status: "online",
    lastHeartbeatAt: now,
    version: "2.0.0",
    region: "eu-central",
    host: "runner-host"
  });
  assert.deepEqual(persistence.runnerNode.create.metadata, {
    workerId: "runner-host:1234"
  });
});

test("runner heartbeat does not erase optional node metadata on update", () => {
  const persistence = buildRunnerHeartbeatPersistence({
    botsRunning: 0,
    botsErrored: 0
  }, new Date("2026-08-30T10:54:08.025Z"));

  assert.equal("version" in persistence.runnerNode.update, false);
  assert.equal("region" in persistence.runnerNode.update, false);
  assert.equal("host" in persistence.runnerNode.update, false);
});
