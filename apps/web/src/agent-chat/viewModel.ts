import type { AgentActivity, AgentProfile, AgentSkill } from "./contracts";

export function enabledSkillsForProfile(profile: AgentProfile | null, skills: AgentSkill[]): AgentSkill[] {
  if (!profile) return [];
  const enabled = new Set(profile.enabledSkillIds);
  return skills.filter((skill) => enabled.has(skill.id));
}

export function activityTone(status: string): "loading" | "success" | "degraded" | "failed" | "blocked" {
  if (status === "success") return "success";
  if (status === "degraded") return "degraded";
  if (status === "failed") return "failed";
  if (status === "blocked") return "blocked";
  return "loading";
}

export function orderedActivityItems(activity: AgentActivity | null) {
  return activity?.toolCalls ?? [];
}

export function canSendAgentMessage(params: { content: string; loading: boolean; profile: AgentProfile | null; selectedExchangeAccountId: string | null }): boolean {
  if (params.loading || !params.content.trim() || !params.profile) return false;
  return params.profile.actionLevel !== "account_read" || Boolean(params.selectedExchangeAccountId);
}
