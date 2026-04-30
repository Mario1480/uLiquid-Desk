import type { Hex } from "viem";

type NonceState = {
  tail: Promise<void>;
  nextNonce: number | null;
};

type ControllerTransactionRequest = {
  to: `0x${string}`;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
};

type ControllerTransactionClient = {
  account: { address: `0x${string}` } & Record<string, unknown>;
  chain: { id: number } & Record<string, unknown>;
  publicClient?: {
    getTransactionCount?: (args: { address: `0x${string}`; blockTag?: "latest" | "pending" }) => Promise<number>;
  } | null;
  walletClient: {
    sendTransaction: (args: any) => Promise<`0x${string}`>;
  };
};

const nonceStateByKey = new Map<string, NonceState>();

function getNonceState(key: string): NonceState {
  let state = nonceStateByKey.get(key);
  if (state) return state;
  state = {
    tail: Promise.resolve(),
    nextNonce: null
  };
  nonceStateByKey.set(key, state);
  return state;
}

async function withNonceLock<T>(key: string, fn: (state: NonceState) => Promise<T>): Promise<T> {
  const state = getNonceState(key);
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  // A failed previous holder must not deadlock the serialized nonce queue.
  await previous.catch(() => undefined);
  try {
    return await fn(state);
  } finally {
    release();
  }
}

function isRateLimitedError(error: unknown): boolean {
  return /rate limited|limitexceededrpcerror|request exceeds defined limit|429|too many requests/i.test(String(error ?? ""));
}

function isNonceSyncError(error: unknown): boolean {
  return /nonce too low|nonce too high|already known|known transaction|replacement transaction underpriced|transaction underpriced/i.test(
    String(error ?? "")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnRateLimit<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitedError(error) || attempt >= attempts - 1) {
        throw error;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "controller_transaction_retry_failed"));
}

export async function sendSerializedControllerTransaction(
  client: ControllerTransactionClient,
  request: ControllerTransactionRequest
): Promise<`0x${string}`> {
  const getTransactionCount = client.publicClient?.getTransactionCount;
  if (typeof getTransactionCount !== "function") {
    return retryOnRateLimit(() => client.walletClient.sendTransaction({
      account: client.account,
      chain: client.chain,
      ...request
    }), 4, 750);
  }

  const nonceKey = `${client.chain.id}:${client.account.address.toLowerCase()}`;
  return withNonceLock(nonceKey, async (state) => {
    if (state.nextNonce === null) {
      state.nextNonce = await retryOnRateLimit(
        () => getTransactionCount({
          address: client.account.address,
          blockTag: "pending"
        }),
        4,
        600
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nonce = state.nextNonce;
      if (nonce == null) throw new Error("controller_transaction_nonce_unavailable");
      try {
        const txHash = await retryOnRateLimit(() => client.walletClient.sendTransaction({
          account: client.account,
          chain: client.chain,
          ...request,
          nonce
        }), 4, 750);
        state.nextNonce = nonce + 1;
        return txHash;
      } catch (error) {
        state.nextNonce = null;
        if (isNonceSyncError(error) && attempt === 0) {
          state.nextNonce = await retryOnRateLimit(
            () => getTransactionCount({
              address: client.account.address,
              blockTag: "pending"
            }),
            4,
            600
          );
          continue;
        }
        throw error;
      }
    }
    throw new Error("controller_transaction_send_failed");
  });
}

export function resetSerializedControllerTransactionStateForTests(): void {
  nonceStateByKey.clear();
}
