import { DeskBadge } from "@/components/desk/DeskBadge";
import { DeskButton } from "@/components/desk/DeskButton";
import { DeskInput } from "@/components/desk/DeskInput";
import { DeskSelect } from "@/components/desk/DeskSelect";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
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
  const accountRequired = accountRead && !context.selectedExchangeAccountId;
  const accountSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!accountRequired || disabled) return;
    accountSelectRef.current?.focus({ preventScroll: true });
    accountSelectRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [accountRequired, disabled]);

  return (
    <div className="agentChatContextBar" aria-label={t("context.ariaLabel")}>
      <label><span>{t("context.profile")}</span><DeskSelect className="input" disabled={disabled} value={context.profileId} onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); if (!profile) return; onChange({ profileId: profile.id, profileKey: profile.baseProfileKey, selectedExchangeAccountId: profile.actionLevel === "account_read" ? context.selectedExchangeAccountId : null, symbol: profile.actionLevel === "account_read" ? null : context.symbol || "BTCUSDT" }); }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</DeskSelect></label>
      <label><span>{t("context.venue")}</span><DeskSelect className="input" disabled={disabled} value={context.selectedVenue} onChange={(event) => onChange({ selectedVenue: event.target.value as AgentContextDraft["selectedVenue"] })}><option value="auto">Auto</option><option value="hyperliquid">Hyperliquid</option><option value="binance">Binance</option><option value="bitget">Bitget</option><option value="mexc">MEXC</option><option value="bingx">BingX</option></DeskSelect></label>
      {accountRead ? <label><span>{t("context.account")}{accountRequired ? <em className="agentChatRequiredFlag">{t("context.required")}</em> : null}</span><DeskSelect ref={accountSelectRef} className={`input${accountRequired ? " agentChatAccountSelectRequired" : ""}`} required aria-invalid={accountRequired} disabled={disabled} value={context.selectedExchangeAccountId ?? ""} onChange={(event) => onChange({ selectedExchangeAccountId: event.target.value || null })}><option value="">{t("context.selectAccount")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.exchange.toUpperCase()} · {account.label}</option>)}</DeskSelect></label> : null}
      <label><span>{t("context.marketType")}</span><DeskSelect className="input" disabled={disabled} value={context.marketType} onChange={(event) => onChange({ marketType: event.target.value as AgentContextDraft["marketType"] })}><option value="perp">Perp</option><option value="spot">Spot</option></DeskSelect></label>
      <label><span>{accountRead ? t("context.symbolFilter") : t("context.symbol")}</span><DeskInput className="input" disabled={disabled} value={context.symbol ?? ""} placeholder={accountRead ? t("context.allPositions") : undefined} maxLength={32} onChange={(event) => onChange({ symbol: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") || null })} /></label>
      <DeskBadge className="badge agentChatAccessBadge"><AppIcon name="shield" />{accountRead ? t("access.readOnly") : t("access.publicData")}</DeskBadge>
      <DeskButton type="button" className="btn" onClick={onOpenSkills}><AppIcon name="ai" />{t("skills.button", { count: skillCount })}</DeskButton>
    </div>
  );
}
