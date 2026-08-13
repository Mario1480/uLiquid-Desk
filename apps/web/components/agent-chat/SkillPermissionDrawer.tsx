import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import type { AgentAccount, AgentProfile, AgentSkill } from "../../src/agent-chat/contracts";

export default function SkillPermissionDrawer({ open, profile, skills, accounts, onClose }: { open: boolean; profile: AgentProfile | null; skills: AgentSkill[]; accounts: AgentAccount[]; onClose: () => void }) {
  const t = useTranslations("agentChat");
  if (!open) return null;
  const enabled = new Set(profile?.enabledSkillIds ?? []);
  const skillName = (skill: AgentSkill) => {
    const key = `skills.names.${skill.id.replaceAll(".", "_")}`;
    return t.has(key) ? t(key) : skill.title;
  };
  return (
    <div className="agentChatDrawerBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="agentChatDrawer" role="dialog" aria-modal="true" aria-labelledby="agent-skills-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="agentChatDrawerHeader"><div><h2 id="agent-skills-title">{t("skills.title")}</h2><p>{profile?.name}</p></div><button type="button" className="btn" onClick={onClose}><AppIcon name="close" />{t("actions.close")}</button></div>
        <div className="agentChatDrawerSection"><h3>{t("skills.enabled")}</h3><div className="agentChatSkillList">{skills.filter((skill) => enabled.has(skill.id)).map((skill) => <article key={skill.id} title={skill.id}><span className="agentChatSkillIcon"><AppIcon name={skill.category === "risk" ? "risk" : skill.category === "portfolio" ? "accounts" : "ai"} /></span><div><strong>{skillName(skill)}</strong><p>{t(`skills.categoryDescriptions.${skill.category}`)}</p></div><span className="badge">{skill.accessLevel === "account_read" ? t("access.readOnly") : t("access.publicData")}</span></article>)}</div></div>
        <div className="agentChatDrawerSection"><h3>{t("permissions.title")}</h3><dl className="agentChatPermissionList"><div><dt>{t("permissions.actionLevel")}</dt><dd>{profile?.actionLevel === "account_read" ? t("access.readOnly") : t("access.publicData")}</dd></div><div><dt>{t("permissions.accounts")}</dt><dd>{profile?.actionLevel === "account_read" ? accounts.length : 0}</dd></div><div><dt>{t("permissions.execution")}</dt><dd>{t("permissions.executionNone")}</dd></div></dl><div className="uiNotice">{t("permissions.notice")}</div></div>
      </section>
    </div>
  );
}
