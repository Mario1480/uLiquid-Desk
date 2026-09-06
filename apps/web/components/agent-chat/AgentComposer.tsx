import { DeskButton } from "@/components/desk/DeskButton";
import { DeskTextarea } from "@/components/desk/DeskTextarea";
import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";

export default function AgentComposer({ value, loading, disabled, disabledReason, onChange, onSend, onShowActivity }: { value: string; loading: boolean; disabled: boolean; disabledReason?: string | null; onChange: (value: string) => void; onSend: () => void; onShowActivity: () => void }) {
  const t = useTranslations("agentChat");
  return (
    <div className="agentChatComposer">
      <DeskTextarea className="input" rows={2} value={value} maxLength={8000} placeholder={t("composer.placeholder")} disabled={loading} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!disabled) onSend(); } }} />
      <div className="agentChatComposerActions"><DeskButton type="button" className="btn agentChatActivityToggle" aria-label={t("decisionLog.title")} onClick={onShowActivity}><AppIcon name="audit" />{t("decisionLog.open")}</DeskButton><span className={disabledReason ? "agentChatComposerRequirement" : undefined} role={disabledReason ? "status" : undefined}>{disabledReason ?? t("composer.hint")}</span><DeskButton type="button" className="btn btnPrimary" disabled={disabled} onClick={onSend}><AppIcon name="send" />{loading ? t("composer.sending") : t("composer.send")}</DeskButton></div>
    </div>
  );
}
