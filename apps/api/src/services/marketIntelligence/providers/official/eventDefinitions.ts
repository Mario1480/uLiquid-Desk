import type { EconomicImportance } from "../../contracts/economicCalendar.js";

export type EconomicEventDefinition = {
  key: string;
  title: string;
  country: string;
  currency: string;
  category: string;
  defaultImportance: EconomicImportance;
  officialSource: string;
  scheduleStrategy: string;
  releaseStrategy?: string;
  timezone: string;
  matchPatterns: RegExp[];
};

export const ECONOMIC_EVENT_DEFINITIONS: EconomicEventDefinition[] = [
  {
    key: "us_fomc_rate_decision",
    title: "FOMC Interest Rate Decision",
    country: "US",
    currency: "USD",
    category: "central_bank",
    defaultImportance: "high",
    officialSource: "Federal Reserve",
    scheduleStrategy: "curated_fomc_calendar",
    timezone: "America/New_York",
    matchPatterns: [/fomc.*(meeting|rate|statement)/i]
  },
  {
    key: "us_fomc_press_conference",
    title: "FOMC Press Conference",
    country: "US",
    currency: "USD",
    category: "central_bank",
    defaultImportance: "high",
    officialSource: "Federal Reserve",
    scheduleStrategy: "curated_fomc_calendar",
    timezone: "America/New_York",
    matchPatterns: [/fomc.*press conference/i]
  },
  {
    key: "us_cpi",
    title: "Consumer Price Index (CPI)",
    country: "US",
    currency: "USD",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Labor Statistics",
    scheduleStrategy: "bls_ics",
    releaseStrategy: "bls_public_data",
    timezone: "America/New_York",
    matchPatterns: [/consumer price index/i]
  },
  {
    key: "us_core_cpi",
    title: "Core Consumer Price Index (Core CPI)",
    country: "US",
    currency: "USD",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Labor Statistics",
    scheduleStrategy: "bls_ics",
    releaseStrategy: "bls_public_data",
    timezone: "America/New_York",
    matchPatterns: [/consumer price index/i]
  },
  {
    key: "us_ppi",
    title: "Producer Price Index (PPI)",
    country: "US",
    currency: "USD",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Labor Statistics",
    scheduleStrategy: "bls_ics",
    releaseStrategy: "bls_public_data",
    timezone: "America/New_York",
    matchPatterns: [/producer price index/i]
  },
  {
    key: "us_nonfarm_payrolls",
    title: "Nonfarm Payrolls",
    country: "US",
    currency: "USD",
    category: "labor",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Labor Statistics",
    scheduleStrategy: "bls_ics",
    releaseStrategy: "bls_public_data",
    timezone: "America/New_York",
    matchPatterns: [/employment situation/i]
  },
  {
    key: "us_unemployment_rate",
    title: "Unemployment Rate",
    country: "US",
    currency: "USD",
    category: "labor",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Labor Statistics",
    scheduleStrategy: "bls_ics",
    releaseStrategy: "bls_public_data",
    timezone: "America/New_York",
    matchPatterns: [/employment situation/i]
  },
  {
    key: "us_initial_jobless_claims",
    title: "Initial Jobless Claims",
    country: "US",
    currency: "USD",
    category: "labor",
    defaultImportance: "medium",
    officialSource: "U.S. Department of Labor",
    scheduleStrategy: "curated_official_schedule",
    timezone: "America/New_York",
    matchPatterns: [/initial (unemployment|jobless) claims/i]
  },
  {
    key: "us_gdp",
    title: "U.S. Gross Domestic Product (GDP)",
    country: "US",
    currency: "USD",
    category: "growth",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Economic Analysis",
    scheduleStrategy: "curated_official_schedule",
    releaseStrategy: "bea_public_data",
    timezone: "America/New_York",
    matchPatterns: [/gross domestic product|\bgdp\b/i]
  },
  {
    key: "us_retail_sales",
    title: "U.S. Retail Sales",
    country: "US",
    currency: "USD",
    category: "consumption",
    defaultImportance: "high",
    officialSource: "U.S. Census Bureau",
    scheduleStrategy: "curated_official_schedule",
    timezone: "America/New_York",
    matchPatterns: [/retail sales/i]
  },
  {
    key: "us_pce",
    title: "Personal Consumption Expenditures (PCE)",
    country: "US",
    currency: "USD",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Economic Analysis",
    scheduleStrategy: "curated_official_schedule",
    releaseStrategy: "bea_public_data",
    timezone: "America/New_York",
    matchPatterns: [/personal income and outlays|personal consumption expenditures|\bpce\b/i]
  },
  {
    key: "us_core_pce",
    title: "Core Personal Consumption Expenditures (Core PCE)",
    country: "US",
    currency: "USD",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "U.S. Bureau of Economic Analysis",
    scheduleStrategy: "curated_official_schedule",
    releaseStrategy: "bea_public_data",
    timezone: "America/New_York",
    matchPatterns: [/personal income and outlays|personal consumption expenditures|\bpce\b/i]
  },
  {
    key: "eu_ecb_rate_decision",
    title: "ECB Interest Rate Decision",
    country: "EU",
    currency: "EUR",
    category: "central_bank",
    defaultImportance: "high",
    officialSource: "European Central Bank",
    scheduleStrategy: "curated_ecb_calendar",
    timezone: "Europe/Berlin",
    matchPatterns: [/ecb.*(monetary policy|interest rate|governing council)/i]
  },
  {
    key: "eu_ecb_press_conference",
    title: "ECB Press Conference",
    country: "EU",
    currency: "EUR",
    category: "central_bank",
    defaultImportance: "high",
    officialSource: "European Central Bank",
    scheduleStrategy: "curated_ecb_calendar",
    timezone: "Europe/Berlin",
    matchPatterns: [/ecb.*press conference/i]
  },
  {
    key: "eu_cpi",
    title: "Euro Area Consumer Price Index (CPI)",
    country: "EU",
    currency: "EUR",
    category: "inflation",
    defaultImportance: "high",
    officialSource: "Eurostat",
    scheduleStrategy: "curated_official_schedule",
    releaseStrategy: "eurostat_public_data",
    timezone: "Europe/Luxembourg",
    matchPatterns: [/euro area.*(inflation|consumer prices|hicp)/i]
  },
  {
    key: "eu_gdp",
    title: "Euro Area Gross Domestic Product (GDP)",
    country: "EU",
    currency: "EUR",
    category: "growth",
    defaultImportance: "high",
    officialSource: "Eurostat",
    scheduleStrategy: "curated_official_schedule",
    releaseStrategy: "eurostat_public_data",
    timezone: "Europe/Luxembourg",
    matchPatterns: [/euro area.*(gross domestic product|gdp)/i]
  }
];

export function matchEconomicEventDefinitions(summary: string): EconomicEventDefinition[] {
  return ECONOMIC_EVENT_DEFINITIONS.filter((definition) =>
    definition.matchPatterns.some((pattern) => pattern.test(summary))
  );
}
