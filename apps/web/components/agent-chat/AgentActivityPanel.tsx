import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import { activityTone, orderedActivityItems } from "../../src/agent-chat/viewModel";
import type { AgentActivity } from "../../src/agent-chat/contracts";

export default function AgentActivityPanel({ activity, loading, onClose }: { activity: AgentActivity | null; loading: boolean; onClose?: () => void }) {
  const t = useTranslations("agentChat");
  const items = orderedActivityItems(activity);
  return (
    <aside className="agentChatActivity" aria-live="polite" aria-label={t("activity.title")}>
      <div className="agentChatPanelHeader"><strong>{t("activity.title")}</strong>{onClose ? <button type="button" className="btn agentChatMobileClose" onClick={onClose}><AppIcon name="close" />{t("actions.close")}</button> : null}</div>
      {loading ? <div className="agentChatActivityEmpty"><span className="agentChatSpinner" />{t("activity.running")}</div> : items.length === 0 ? <p className="agentChatMuted">{t("activity.empty")}</p> : <ol className="agentChatActivityList">{items.map((item) => { const tone = activityTone(item.status); return <li key={item.id} className={`agentChatActivity-${tone}`}><AppIcon name={tone === "success" ? "check" : tone === "loading" ? "refresh" : "alerts"} /><span><strong>{item.toolName}</strong><small>{item.venue ?? t("activity.internal")}{item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(1)} s` : ""}{item.resultSummary?.fallbackUsed ? ` · ${t("activity.fallback")}` : ""}</small></span></li>; })}</ol>}
      {activity ? <div className="agentChatRunMeta"><span>{activity.provider ?? "—"} · {activity.model ?? "—"}</span><span>{activity.latencyMs ? `${(activity.latencyMs / 1000).toFixed(1)} s` : "—"}</span></div> : null}
    </aside>
  );
}
