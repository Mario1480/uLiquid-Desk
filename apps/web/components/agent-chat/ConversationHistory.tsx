import { DeskButton } from "@/components/desk/DeskButton";
import { useTranslations } from "next-intl";
import { AppIcon } from "../../app/components/AppIcon";
import type { AgentConversation } from "../../src/agent-chat/contracts";

export default function ConversationHistory({ conversations, activeId, onSelect, onNew, onArchive }: { conversations: AgentConversation[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void; onArchive: (id: string) => void }) {
  const t = useTranslations("agentChat");
  return (
    <aside className="agentChatHistory" aria-label={t("history.title")}>
      <div className="agentChatPanelHeader"><strong>{t("history.title")}</strong><DeskButton className="btn" type="button" onClick={onNew}><AppIcon name="create" />{t("actions.newChat")}</DeskButton></div>
      <div className="agentChatHistoryList">
        {conversations.length === 0 ? <p className="agentChatMuted">{t("history.empty")}</p> : conversations.map((conversation) => (
          <DeskButton type="button" key={conversation.id} className={`agentChatHistoryItem ${conversation.id === activeId ? "agentChatHistoryItemActive" : ""}`} onClick={() => onSelect(conversation.id)}>
            <span><strong>{conversation.title}</strong><small>{conversation.symbol ?? t("context.noSymbol")} · {conversation.selectedVenue}</small></span>
            <span className="agentChatArchiveAction" role="button" tabIndex={0} aria-label={t("actions.archive")} onClick={(event) => { event.stopPropagation(); onArchive(conversation.id); }}><AppIcon name="archive" /></span>
          </DeskButton>
        ))}
      </div>
    </aside>
  );
}
