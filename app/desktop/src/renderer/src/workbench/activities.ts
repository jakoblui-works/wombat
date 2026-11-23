// Importing this module registers the activities and their panels, in the toolbar's order.
import { Columns2, FilePen, FileText, Inbox, LibraryBig, List, MessageSquare } from "lucide-react";

import "../harnesses/claude/claude-ui.ts";
import { AGENTS_PANEL, DESK_ACTIVITY, DESK_PANEL, NEEDS_ME_PANEL } from "./activity-ids.ts";
import { registerOnce } from "../lib/register-once.ts";
import { NavigatorParams, registerActivity, registerPanel } from "./registry.ts";
import { NAVIGATOR_WIDTH } from "./shell/shell-state.ts";
import { AgentsList } from "./panels/AgentsList/AgentsList.tsx";
import { Chat } from "./panels/Chat/Chat.tsx";
import { CHAT_PANEL, ChatParams, chatResolves, chatTitle, NEW_CHAT_PANEL } from "./agents/chat-params.ts";
import { NewChat } from "./panels/Chat/NewChat.tsx";
import { Diff } from "./panels/Diff/Diff.tsx";
import { DIFF_TITLE, DIFF_PANEL, DiffParams, diffResolves, diffRestores } from "./panels/Diff/diff-params.ts";
import { NeedsMe } from "./panels/NeedsMe/NeedsMe.tsx";
import { Proposal } from "./panels/Proposal/Proposal.tsx";
import { PROPOSAL_TITLE, PROPOSAL_PANEL, ProposalParams, proposalResolves, proposalRestores } from "./proposals/proposal-params.ts";
import { Desk } from "./panels/Desk/Desk.tsx";
import { Item } from "./panels/Item/Item.tsx";
import { ITEM_PANEL, ITEM_TITLE, ItemParams, itemTabSaved } from "./items/item-params.ts";

const register = (): void => {
  // The shell places these itself, never as a tab or a navigator.
  registerPanel({ id: AGENTS_PANEL, title: "Agents", icon: List, locations: [], component: AgentsList });
  registerPanel({ id: CHAT_PANEL, title: chatTitle, icon: MessageSquare, locations: [], component: Chat, paramsSchema: ChatParams, resolves: chatResolves });
  registerPanel({ id: NEW_CHAT_PANEL, title: "New agent", icon: MessageSquare, locations: [], component: NewChat });
  registerPanel({ id: NEEDS_ME_PANEL, title: "Needs me", icon: Inbox, locations: [], component: NeedsMe });

  registerPanel({
    id: DIFF_PANEL,
    // The panel reports "<file name> (diff)" once it has read the request (the agents list doesn't name the file).
    title: DIFF_TITLE,
    icon: Columns2,
    locations: ["tab"],
    wants: 800,
    component: Diff,
    paramsSchema: DiffParams,
    resolves: diffResolves,
    restores: diffRestores,
  });

  registerPanel({
    id: PROPOSAL_PANEL,
    // The panel reports the proposal's label once it has read the proposal.
    title: PROPOSAL_TITLE,
    icon: FilePen,
    locations: ["tab"],
    wants: 800,
    component: Proposal,
    paramsSchema: ProposalParams,
    resolves: proposalResolves,
    restores: proposalRestores,
  });

  registerActivity({ id: DESK_ACTIVITY, title: "Desk", icon: LibraryBig, navigator: DESK_PANEL });
  registerPanel({ id: DESK_PANEL, title: "Desk", icon: LibraryBig, locations: ["navigator"], activity: DESK_ACTIVITY, wants: 280, component: Desk, paramsSchema: NavigatorParams });
  registerPanel({
    id: ITEM_PANEL,
    // The panel reports the item's handle and title once it has read the item.
    title: ITEM_TITLE,
    icon: FileText,
    locations: ["tab"],
    activity: DESK_ACTIVITY,
    wants: NAVIGATOR_WIDTH + 280,
    component: Item,
    paramsSchema: ItemParams,
    saves: itemTabSaved,
  });
};

registerOnce(import.meta.hot, register);
