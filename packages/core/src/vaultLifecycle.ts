function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeStringLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

const PENDING_ONCHAIN_ACTION_STATUSES = new Set(["prepared", "submitted"]);
const BOT_WITHDRAW_PENDING_ACTION_TYPES = new Set(["claim_from_bot_vault", "close_bot_vault"]);
const MASTER_FUNDING_ACTION_TYPES = new Set(["create_master_vault", "deposit_master_vault"]);
const MASTER_WITHDRAW_ACTION_TYPES = new Set(["withdraw_master_vault"]);

export type BotVaultStatusValue = "ACTIVE" | "PAUSED" | "STOPPED" | "CLOSE_ONLY" | "CLOSED" | "ERROR";
export type BotVaultExecutionStatusValue = "created" | "running" | "paused" | "close_only" | "closed" | "error";
export type BotVaultLifecycleState =
  | "bot_creation"
  | "bot_activation"
  | "execution_active"
  | "paused"
  | "settling"
  | "withdraw_pending"
  | "closed"
  | "error";
export type BotVaultLifecycleMode = "normal" | "close_only";

export type BotVaultLifecycleResolution = {
  state: BotVaultLifecycleState;
  baseState: Exclude<BotVaultLifecycleState, "settling" | "withdraw_pending">;
  mode: BotVaultLifecycleMode;
  status: BotVaultStatusValue;
  executionStatus: BotVaultExecutionStatusValue;
  pendingActionType: string | null;
  pendingActionStatus: string | null;
  lifecycleOverrideState: string | null;
  needsIntervention: boolean;
  isTerminal: boolean;
  canAcceptNewOrders: boolean;
};

export type MasterVaultLifecycleState = "master_funding" | "withdraw_pending" | "ready" | "closed" | "error";

export type MasterVaultLifecycleResolution = {
  state: MasterVaultLifecycleState;
  status: string;
  pendingActionType: string | null;
  pendingActionStatus: string | null;
  isTerminal: boolean;
};

export function normalizeBotVaultStatus(value: unknown): BotVaultStatusValue {
  const raw = normalizeString(value).toUpperCase();
  if (raw === "PAUSED") return "PAUSED";
  if (raw === "STOPPED") return "STOPPED";
  if (raw === "CLOSE_ONLY") return "CLOSE_ONLY";
  if (raw === "CLOSED") return "CLOSED";
  if (raw === "ERROR") return "ERROR";
  return "ACTIVE";
}

export function normalizeBotVaultExecutionStatus(value: unknown): BotVaultExecutionStatusValue {
  const raw = normalizeStringLower(value);
  if (raw === "running") return "running";
  if (raw === "paused") return "paused";
  if (raw === "close_only") return "close_only";
  if (raw === "closed") return "closed";
  if (raw === "error") return "error";
  return "created";
}

function readPendingActionStatus(value: unknown): string | null {
  const normalized = normalizeStringLower(value);
  return normalized || null;
}

function readPendingActionType(value: unknown): string | null {
  const normalized = normalizeStringLower(value);
  return normalized || null;
}

function readLifecycleOverrideState(metadata: Record<string, unknown>): string | null {
  const overrideState = normalizeStringLower(metadata.lifecycleOverrideState);
  if (overrideState) return overrideState;
  const lifecycle = toRecord(metadata.lifecycle);
  const nestedOverrideState = normalizeStringLower(lifecycle.overrideState);
  return nestedOverrideState || null;
}

function isPendingOnchainAction(status: string | null): boolean {
  return Boolean(status && PENDING_ONCHAIN_ACTION_STATUSES.has(status));
}

export function deriveBotVaultLifecycleState(input: {
  status?: unknown;
  executionStatus?: unknown;
  executionLastError?: unknown;
  executionMetadata?: unknown;
  pendingActionType?: unknown;
  pendingActionStatus?: unknown;
}): BotVaultLifecycleResolution {
  const metadata = toRecord(input.executionMetadata);
  const status = normalizeBotVaultStatus(input.status);
  const executionStatus = normalizeBotVaultExecutionStatus(input.executionStatus);
  const pendingActionType = readPendingActionType(input.pendingActionType ?? metadata.pendingOnchainActionType);
  const pendingActionStatus = readPendingActionStatus(input.pendingActionStatus ?? metadata.pendingOnchainActionStatus);
  const lifecycleOverrideState = readLifecycleOverrideState(metadata);
  const errorReason = normalizeString(input.executionLastError);
  const mode: BotVaultLifecycleMode = status === "CLOSE_ONLY" || executionStatus === "close_only"
    ? "close_only"
    : "normal";

  let baseState: BotVaultLifecycleResolution["baseState"];
  if (status === "CLOSED") {
    baseState = "closed";
  } else if (status === "ERROR" || executionStatus === "error" || errorReason) {
    baseState = "error";
  } else if (
    status === "PAUSED"
    || status === "STOPPED"
    || executionStatus === "paused"
    || executionStatus === "closed"
    || mode === "close_only"
  ) {
    baseState = "paused";
  } else if (executionStatus === "running") {
    baseState = "execution_active";
  } else if (executionStatus === "created") {
    baseState = "bot_activation";
  } else {
    baseState = "bot_creation";
  }

  let state: BotVaultLifecycleState = baseState;
  if (status === "CLOSED") {
    state = "closed";
  } else if (lifecycleOverrideState === "settling") {
    state = "settling";
  } else if (
    isPendingOnchainAction(pendingActionStatus)
    && pendingActionType
    && BOT_WITHDRAW_PENDING_ACTION_TYPES.has(pendingActionType)
  ) {
    state = "withdraw_pending";
  } else if (
    isPendingOnchainAction(pendingActionStatus)
    && pendingActionType === "create_bot_vault"
  ) {
    state = "bot_creation";
  }

  return {
    state,
    baseState,
    mode,
    status,
    executionStatus,
    pendingActionType,
    pendingActionStatus,
    lifecycleOverrideState,
    needsIntervention: state === "error",
    isTerminal: state === "closed",
    canAcceptNewOrders: state === "execution_active" && mode === "normal"
  };
}

export function buildBotVaultLifecycleMetadata(input: {
  status?: unknown;
  executionStatus?: unknown;
  executionLastError?: unknown;
  executionMetadata?: unknown;
  pendingActionType?: unknown;
  pendingActionStatus?: unknown;
  updatedAt?: string | Date | null;
}): { lifecycle: Record<string, unknown> } {
  const lifecycle = deriveBotVaultLifecycleState(input);
  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.toISOString()
    : normalizeString(input.updatedAt) || new Date().toISOString();
  return {
    lifecycle: {
      state: lifecycle.state,
      baseState: lifecycle.baseState,
      mode: lifecycle.mode,
      status: lifecycle.status,
      executionStatus: lifecycle.executionStatus,
      pendingActionType: lifecycle.pendingActionType,
      pendingActionStatus: lifecycle.pendingActionStatus,
      overrideState: lifecycle.lifecycleOverrideState,
      needsIntervention: lifecycle.needsIntervention,
      isTerminal: lifecycle.isTerminal,
      canAcceptNewOrders: lifecycle.canAcceptNewOrders,
      updatedAt
    }
  };
}

const BOT_LIFECYCLE_TRANSITIONS: Record<BotVaultLifecycleState, BotVaultLifecycleState[]> = {
  bot_creation: ["bot_activation", "paused", "error"],
  bot_activation: ["execution_active", "paused", "settling", "withdraw_pending", "error"],
  execution_active: ["paused", "settling", "withdraw_pending", "error"],
  paused: ["bot_activation", "execution_active", "settling", "withdraw_pending", "closed", "error"],
  settling: ["withdraw_pending", "closed", "error"],
  withdraw_pending: ["execution_active", "paused", "closed", "error"],
  closed: [],
  error: ["paused", "settling", "closed"]
};

export function canTransitionBotVaultLifecycle(params: {
  fromState: BotVaultLifecycleState;
  toState: BotVaultLifecycleState;
}): boolean {
  if (params.fromState === params.toState) return true;
  return BOT_LIFECYCLE_TRANSITIONS[params.fromState].includes(params.toState);
}

export function assertBotVaultLifecycleTransition(params: {
  fromState: BotVaultLifecycleState;
  toState: BotVaultLifecycleState;
}) {
  if (canTransitionBotVaultLifecycle(params)) return;
  throw new Error(`vault_lifecycle_transition_not_allowed:${params.fromState}->${params.toState}`);
}

export function deriveMasterVaultLifecycleState(input: {
  status?: unknown;
  pendingActionType?: unknown;
  pendingActionStatus?: unknown;
}): MasterVaultLifecycleResolution {
  const status = normalizeStringLower(input.status) || "active";
  const pendingActionType = readPendingActionType(input.pendingActionType);
  const pendingActionStatus = readPendingActionStatus(input.pendingActionStatus);

  if (status === "closed") {
    return {
      state: "closed",
      status,
      pendingActionType,
      pendingActionStatus,
      isTerminal: true
    };
  }

  if (status === "error") {
    return {
      state: "error",
      status,
      pendingActionType,
      pendingActionStatus,
      isTerminal: false
    };
  }

  if (isPendingOnchainAction(pendingActionStatus) && pendingActionType && MASTER_FUNDING_ACTION_TYPES.has(pendingActionType)) {
    return {
      state: "master_funding",
      status,
      pendingActionType,
      pendingActionStatus,
      isTerminal: false
    };
  }

  if (isPendingOnchainAction(pendingActionStatus) && pendingActionType && MASTER_WITHDRAW_ACTION_TYPES.has(pendingActionType)) {
    return {
      state: "withdraw_pending",
      status,
      pendingActionType,
      pendingActionStatus,
      isTerminal: false
    };
  }

  return {
    state: "ready",
    status,
    pendingActionType,
    pendingActionStatus,
    isTerminal: false
  };
}
