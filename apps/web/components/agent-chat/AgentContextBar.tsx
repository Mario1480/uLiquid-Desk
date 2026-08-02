import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import type { AgentAccount, AgentContextDraft, AgentProfile } from "../../src/agent-chat/contracts";

export default function AgentContextBar({ context, profiles, accounts, activeProfile, skillCount, disabled, onChange, onOpenSkills }: {
  context: AgentContextDraft;
  profiles: AgentProfile[];
  accounts: AgentAccount[];
  activeProfile: AgentProfile | null;
  skillCount: number;
  disabled: boolean;
  onChange: (patch: Partial<AgentContextDraft>) => void;
  onOpenSkills: () => void;
}) {
  const t = useTranslations("agentChat");
  const accountRead = activeProfile?.actionLevel === "account_read";
  return (
    <div className="agentChatContextBar" aria-label={t("context.ariaLabel")}>
      <label><span>{t("context.profile")}</span><select className="input" disabled={disabled} value={context.profileId} onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); if (!profile) return; onChange({ profileId: profile.id, profileKey: profile.baseProfileKey, selectedExchangeAccountId: profile.actionLevel === "account_read" ? context.selectedExchangeAccountId : null }); }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <label><span>{t("context.venue")}</span><select className="input" disabled={disabled} value={context.selectedVenue} onChange={(event) => onChange({ selectedVenue: event.target.value as AgentContextDraft["selectedVenue"] })}><option value="auto">Auto</option><option value="hyperliquid">Hyperliquid</option><option value="binance">Binance</option><option value="bitget">Bitget</option><option value="mexc">MEXC</option><option value="bingx">BingX</option></select></label>
      {accountRead ? <label><span>{t("context.account")}</span><select className="input" disabled={disabled} value={context.selectedExchangeAccountId ?? ""} onChange={(event) => onChange({ selectedExchangeAccountId: event.target.value || null })}><option value="">{t("context.selectAccount")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.exchange.toUpperCase()} · {account.label}</option>)}</select></label> : null}
      <label><span>{t("context.marketType")}</span><select className="input" disabled={disabled} value={context.marketType} onChange={(event) => onChange({ marketType: event.target.value as AgentContextDraft["marketType"] })}><option value="perp">Perp</option><option value="spot">Spot</option></select></label>
      <label><span>{t("context.symbol")}</span><input className="input" disabled={disabled} value={context.symbol} maxLength={32} onChange={(event) => onChange({ symbol: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></label>
      <span className="badge agentChatAccessBadge"><AppIcon name="shield" />{accountRead ? t("access.readOnly") : t("access.publicData")}</span>
      <button type="button" className="btn" onClick={onOpenSkills}><AppIcon name="ai" />{t("skills.button", { count: skillCount })}</button>
    </div>
  );
}
