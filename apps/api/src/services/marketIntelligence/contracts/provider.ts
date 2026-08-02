export type ProviderWarning = {
  code: string;
  message: string;
  retryable?: boolean;
  sourceId?: string;
};

export type ProviderResult<T> = {
  providerId: string;
  data: T;
  warnings: ProviderWarning[];
  latencyMs: number;
  fetchedAt: string;
  degraded: boolean;
  stale?: boolean;
};

export type ProviderState = {
  providerId: string;
  providerType: "news" | "economic_calendar" | "ai_summary";
  state: "healthy" | "degraded" | "unavailable" | "disabled";
  enabled: boolean;
  checkedAt: string;
  lastSuccessAt?: string;
  latencyMs?: number;
  message?: string;
  staleDataAgeSeconds?: number;
  itemCount?: number;
  duplicateCount?: number;
  licenseStatus?: "pending_review" | "approved" | "blocked";
  termsReviewedAt?: string;
  circuitState?: "closed" | "open" | "half_open";
  quota?: {
    remaining?: number;
    resetAt?: string;
  };
};

export type AggregatedResponseMeta = {
  generatedAt: string;
  providerStates: ProviderState[];
  degraded: boolean;
  warnings: string[];
  nextRefreshAt?: string;
  stale?: boolean;
};
