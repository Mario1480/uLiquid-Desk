import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import type { AgentDecisionLog } from "../../src/agent-chat/contracts";
import AgentMessageBlocks from "./AgentMessageBlocks";
import { AgentFeatureEvidence, AgentSnapshotEvidence } from "./AgentFeatureEvidence";

export default function AgentActivityPanel({ logs, loading, error = false, onClose }: { logs: AgentDecisionLog[]; loading: boolean; error?: boolean; onClose?: () => void }) {
  const t = useTranslations("agentChat");
  const locale = useLocale();
  const reasonText = (reason: string) => t.has(`decisionLog.reasons.${reason}`) ? t(`decisionLog.reasons.${reason}`) : reason;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  useEffect(() => { setSelectedRunId(logs[0]?.runId ?? null); }, [logs]);
  const log = useMemo(() => logs.find((item) => item.runId === selectedRunId) ?? logs[0] ?? null, [logs, selectedRunId]);
  return (
    <aside className="agentChatActivity agentChatDecisionLog" aria-live="polite" aria-label={t("decisionLog.title")}>
      <div className="agentChatPanelHeader"><strong>{t("decisionLog.title")}</strong>{onClose ? <button type="button" className="btn agentChatMobileClose" onClick={onClose}><AppIcon name="close" />{t("actions.close")}</button> : null}</div>
      {error ? <p role="alert" className="agentChatMuted">{t("decisionLog.loadError")}</p> : null}
      {logs.length > 1 ? <label className="agentChatDecisionSelect"><span>{t("decisionLog.recentRuns")}</span><select className="input" value={log?.runId ?? ""} onChange={(event) => setSelectedRunId(event.target.value)}>{logs.map((item) => <option key={item.runId} value={item.runId}>{new Date(item.createdAt).toLocaleString(locale)} · {item.state}</option>)}</select></label> : null}
      {loading && logs.length === 0 ? <div className="agentChatActivityEmpty"><span className="agentChatSpinner" />{t("decisionLog.loading")}</div> : !log ? <p className="agentChatMuted">{t("decisionLog.empty")}</p> : <div className="agentChatDecisionBody">
        <div className="agentChatNoExecution"><AppIcon name="shield" /><strong>{t("decisionLog.noExecution")}</strong></div>
        <p className="agentChatMuted">{t("decisionLog.recordedEvidence")}</p>
        {log.legacyAssociation ? <p className="agentChatMuted">{t("decisionLog.legacyAssociation")}</p> : null}
        <section><small>{t("decisionLog.recommendation")}</small><p>{log.recommendation?.content ?? t("decisionLog.noRecommendation")}</p>{log.recommendation?.blocks.length ? <AgentMessageBlocks blocks={log.recommendation.blocks} /> : null}</section>
        <section><small>{t("decisionLog.dataQuality")}</small><span className={`badge agentChatQuality-${log.dataQuality.state}`}>{t(`decisionLog.quality.${log.dataQuality.state}`)}</span>{log.dataQuality.reasonCodes.length > 0 ? <ul className="agentChatDecisionWarnings">{log.dataQuality.reasonCodes.map((reason) => <li key={reason}>{reasonText(reason)}</li>)}</ul> : null}</section>
        <section><small>{t("decisionLog.evidence")}</small>{log.evidence.length === 0 ? <p className="agentChatMuted">{t("decisionLog.noEvidence")}</p> : <ol className="agentChatActivityList">{log.evidence.map((item) => <li key={item.toolCallId} className={`agentChatActivity-${item.quality === "fresh" ? "success" : "degraded"}`}><AppIcon name={item.quality === "fresh" ? "check" : "alerts"} /><span><strong>{item.skillId}{item.skillVersion ? ` v${item.skillVersion}` : ""}</strong><small>{item.sourceVenue ?? item.sourceProvider ?? t("activity.internal")} · {t(`decisionLog.quality.${item.quality}`)}{item.durationMs !== null ? ` · ${(item.durationMs / 1000).toFixed(1)} s` : ""}</small>{item.routineVersions.length > 0 ? <small>{item.routineVersions.map((routine) => `${routine.id} v${routine.version}`).join(" · ")}</small> : null}</span></li>)}</ol>}</section>
        <section><small>{t("decisionLog.storedFeatures")}</small>{log.evidence.some(item => item.featureSnapshots?.length) ? log.evidence.flatMap(item => (item.featureSnapshots ?? []).map(feature => <AgentFeatureEvidence key={`${item.toolCallId}:${feature.snapshotId}`} feature={feature} />)) : <p className="agentChatMuted">{t("decisionLog.noStoredFeatures")}</p>}</section>
        {(log.snapshotManifest?.length ?? 0) > 0 ? <section><small>{t("decisionLog.snapshots")}</small>{log.snapshotManifest!.map(snapshot => <AgentSnapshotEvidence key={snapshot.id} snapshot={snapshot} />)}</section> : null}
        <details className="agentChatDecisionTechnical"><summary>{t("decisionLog.technicalActivity")}</summary><ol className="agentChatActivityList">{log.technicalActivity.map((item) => <li key={item.id}><AppIcon name={item.status === "success" ? "check" : "alerts"} /><span><strong>{item.skillId}</strong><small>{item.status}{item.venue ? ` · ${item.venue}` : ""}{item.errorCode ? ` · ${item.errorCode}` : ""}</small></span></li>)}</ol></details>
        <div className="agentChatRunMeta"><span>{log.profile.name} v{log.profile.version}</span><span>{log.modelClass ?? "—"}{log.totalLatencyMs !== null ? ` · ${(log.totalLatencyMs / 1000).toFixed(1)} s` : ""}</span></div>
      </div>}
    </aside>
  );
}
