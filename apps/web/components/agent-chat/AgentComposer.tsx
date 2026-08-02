import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";

export default function AgentComposer({ value, loading, disabled, onChange, onSend, onShowActivity }: { value: string; loading: boolean; disabled: boolean; onChange: (value: string) => void; onSend: () => void; onShowActivity: () => void }) {
  const t = useTranslations("agentChat");
  return (
    <div className="agentChatComposer">
      <textarea className="input" rows={2} value={value} maxLength={8000} placeholder={t("composer.placeholder")} disabled={loading} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!disabled) onSend(); } }} />
      <div className="agentChatComposerActions"><button type="button" className="btn agentChatActivityToggle" onClick={onShowActivity}><AppIcon name="audit" />{t("activity.title")}</button><span>{t("composer.hint")}</span><button type="button" className="btn btnPrimary" disabled={disabled} onClick={onSend}><AppIcon name="send" />{loading ? t("composer.sending") : t("composer.send")}</button></div>
    </div>
  );
}
