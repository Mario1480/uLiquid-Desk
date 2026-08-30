export type RunnerHeartbeatInput = {
  botsRunning: number;
  botsErrored: number;
  workerId?: string | null;
  version?: string | null;
  region?: string | null;
  host?: string | null;
};

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function buildRunnerHeartbeatPersistence(
  input: RunnerHeartbeatInput,
  now = new Date()
) {
  const version = optionalText(input.version);
  const region = optionalText(input.region);
  const host = optionalText(input.host)
    ?? optionalText(input.workerId)?.split(":")[0]
    ?? null;

  return {
    runnerStatus: {
      where: { id: "main" },
      update: {
        lastTickAt: now,
        botsRunning: input.botsRunning,
        botsErrored: input.botsErrored,
        version
      },
      create: {
        id: "main",
        lastTickAt: now,
        botsRunning: input.botsRunning,
        botsErrored: input.botsErrored,
        version
      }
    },
    runnerNode: {
      where: { id: "main" },
      update: {
        name: "Main runner",
        status: "online",
        lastHeartbeatAt: now,
        ...(version ? { version } : {}),
        ...(region ? { region } : {}),
        ...(host ? { host } : {})
      },
      create: {
        id: "main",
        name: "Main runner",
        status: "online",
        lastHeartbeatAt: now,
        version,
        region,
        host,
        metadata: input.workerId ? { workerId: input.workerId } : undefined
      }
    }
  };
}
