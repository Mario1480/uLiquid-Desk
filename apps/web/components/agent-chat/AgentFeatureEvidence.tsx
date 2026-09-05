import { useLocale, useTranslations } from "next-intl";
import type { AgentFeatureSnapshot, AgentMarketSnapshot } from "../../src/agent-chat/contracts";
import { featureMetricRows, featureWarningCodes } from "../../src/agent-chat/featureViewModel";

export function AgentFeatureEvidence({ feature }: { feature: AgentFeatureSnapshot }) {
  const t = useTranslations("agentChat.decisionLog");
  const locale = useLocale();
  const rows = featureMetricRows(feature);
  const warnings = featureWarningCodes(feature);
  return <details className="agentChatFeatureEvidence">
    <summary>{feature.id} v{feature.version}</summary>
    {rows.length ? <dl className="agentChatFeatureMetrics">{rows.map(row => <div key={`${row.key}:${row.band ?? ""}`}>
      <dt>{t(`metrics.${row.key}`)}{row.band !== undefined ? ` · ${row.band} bps` : ""}</dt>
      <dd>{row.value === null ? t("unavailableValue") : new Intl.NumberFormat(locale, { maximumSignificantDigits: 10 }).format(row.value)}{row.value !== null && row.unit ? ` ${["base_asset", "quote_asset", "contracts", "provider_native", "unknown"].includes(row.unit) ? t(`units.${row.unit}`) : row.unit}` : ""}</dd>
    </div>)}</dl> : <p className="agentChatMuted">{t("unsupportedFeatureVersion")}</p>}
    {warnings.length ? <ul className="agentChatDecisionWarnings">{warnings.map(code => <li key={code}>{code}</li>)}</ul> : null}
    <small>{t("featureSnapshot")}<code>{feature.snapshotId}</code></small>
    <small>{t("inputSnapshot")}<code>{feature.inputSnapshotId}</code></small>
  </details>;
}

export function AgentSnapshotEvidence({ snapshot }: { snapshot: AgentMarketSnapshot }) {
  const t = useTranslations("agentChat.decisionLog");
  const locale = useLocale();
  return <details className="agentChatFeatureEvidence">
    <summary>{snapshot.market.sourceVenue} · {snapshot.market.symbol} · {snapshot.market.marketType} · {t(`datasets.${snapshot.dataset}`)}{snapshot.interval ? ` · ${snapshot.interval}` : ""}</summary>
    <small>{t("inputSnapshot")}<code>{snapshot.id}</code></small>
    <small>{snapshot.market.providerId} · {t("schemaVersion")} {snapshot.schemaVersion} · {t("freshnessPolicy")} {snapshot.freshnessPolicyVersion}</small>
    <small>{t("observedAt")}: {snapshot.observedAt ? new Date(snapshot.observedAt).toLocaleString(locale) : t("unavailableValue")}</small>
    <small>{t("fetchedAt")}: {new Date(snapshot.fetchedAt).toLocaleString(locale)}</small>
    <small>{t("ageAtRun")}: {snapshot.ageMs === null ? t("unavailableValue") : `${(snapshot.ageMs / 1000).toFixed(1)} s`} · {t(`quality.${snapshot.quality}`)}</small>
    {snapshot.limit !== null ? <small>{t("coverageLimit", { count: snapshot.limit })}</small> : null}
    <small>{t("nonAtomic")}</small>
    {snapshot.warningCodes.length ? <ul className="agentChatDecisionWarnings">{snapshot.warningCodes.map(code => <li key={code}>{code}</li>)}</ul> : null}
  </details>;
}
