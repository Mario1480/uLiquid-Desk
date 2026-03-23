export type AccessSectionVisibility = {
  tradingDesk: boolean;
  bots: boolean;
  gridBots: boolean;
  predictionsDashboard: boolean;
  economicCalendar: boolean;
  news: boolean;
  strategy: boolean;
};

export type AccessSectionMaintenance = {
  enabled: boolean;
};

export type AccessSectionUsage = {
  bots: number;
  predictionsLocal: number;
  predictionsAi: number;
  predictionsComposite: number;
};

export type AccessSectionSettingsResponse = {
  bypass: boolean;
  visibility: AccessSectionVisibility;
  maintenance: AccessSectionMaintenance & {
    activeForUser: boolean;
  };
  usage: AccessSectionUsage;
};

export type AccessSectionAdminResponse = {
  visibility: AccessSectionVisibility;
  maintenance: AccessSectionMaintenance;
  updatedAt: string | null;
  source: "db" | "default";
  defaults: {
    visibility: AccessSectionVisibility;
    maintenance: AccessSectionMaintenance;
  };
};

export const DEFAULT_ACCESS_SECTION_VISIBILITY: AccessSectionVisibility = {
  tradingDesk: true,
  bots: true,
  gridBots: true,
  predictionsDashboard: true,
  economicCalendar: true,
  news: true,
  strategy: true
};

export const DEFAULT_ACCESS_SECTION_MAINTENANCE: AccessSectionMaintenance = {
  enabled: false
};

export function emptyAccessSectionUsage(): AccessSectionUsage {
  return {
    bots: 0,
    predictionsLocal: 0,
    predictionsAi: 0,
    predictionsComposite: 0
  };
}

export type StrategyLimitBucket = "predictionsLocal" | "predictionsAi" | "predictionsComposite";

export function strategyBucketFromKind(kind: "ai" | "local" | "composite" | null): StrategyLimitBucket {
  if (kind === "local") return "predictionsLocal";
  if (kind === "composite") return "predictionsComposite";
  return "predictionsAi";
}
