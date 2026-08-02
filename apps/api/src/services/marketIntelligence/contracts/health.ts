export type ProviderHealth = {
  providerId: string;
  state: "healthy" | "degraded" | "unavailable" | "disabled";
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
  message?: string;
  staleDataAgeSeconds?: number;
  quota?: {
    remaining?: number;
    resetAt?: string;
  };
};
