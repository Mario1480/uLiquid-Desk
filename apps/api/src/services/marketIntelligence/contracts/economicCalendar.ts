import type { ProviderHealth } from "./health.js";
import type { ProviderResult } from "./provider.js";

export type EconomicImportance = "low" | "medium" | "high";
export type EconomicEventStatus = "scheduled" | "released" | "revised" | "cancelled";

export type EconomicEvent = {
  id: string;
  provider: string;
  sourceName: string;
  sourceUrl?: string;
  country: string;
  currency?: string;
  category: string;
  title: string;
  scheduledAt: string;
  importance: EconomicImportance;
  status: EconomicEventStatus;
  releasedAt?: string;
  actual?: string | number;
  forecast?: string | number;
  previous?: string | number;
  unit?: string;
  period?: string;
  fetchedAt: string;
  originalTimezone?: string;
  timeConfidence?: "exact" | "estimated" | "date_only";
  revision?: number;
};

export type EconomicRelease = {
  eventId: string;
  actual?: string | number;
  previous?: string | number;
  revision?: number;
  releasedAt: string;
  sourceName: string;
  sourceUrl?: string;
};

export type DateRange = { from: string; to: string };

export type FetchEconomicEventsInput = DateRange & {
  currencies?: string[];
  signal?: AbortSignal;
};

export interface EconomicCalendarProvider {
  readonly id: string;
  fetchEvents(input: FetchEconomicEventsInput): Promise<ProviderResult<EconomicEvent[]>>;
  health(): Promise<ProviderHealth>;
}

export interface EconomicScheduleProvider {
  readonly id: string;
  fetchSchedule(range: DateRange): Promise<ProviderResult<EconomicEvent[]>>;
}

export interface EconomicReleaseProvider {
  readonly id: string;
  fetchReleases(range: DateRange): Promise<ProviderResult<EconomicRelease[]>>;
}
