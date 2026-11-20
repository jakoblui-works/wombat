// Importing this module registers the activities and their panels, in the activity bar's order (Agents first).
import { Bot, Columns2, FilePen, Files, FileText, Inbox, GitBranch, LayoutDashboard, LibraryBig, List, MessageSquare, type LucideIcon } from "lucide-react";
import { createElement } from "react";

import "../harnesses/claude/claude-ui.ts";
import { AGENTS_ACTIVITY, DESK_ACTIVITY, DESK_PANEL } from "./activity-ids.ts";
import { type ActivityDescriptor, registerActivity, registerPanel } from "./registry.ts";
import { AgentsList } from "./panels/AgentsList/AgentsList.tsx";
import { Chat } from "./panels/Chat/Chat.tsx";
import { CHAT_PANEL, ChatParams, chatResolves, chatTitle } from "./panels/Chat/chat-params.ts";
import { Diff } from "./panels/Diff/Diff.tsx";
import { DIFF_TITLE, DIFF_PANEL, DiffParams, diffResolves, diffRestores } from "./panels/Diff/diff-params.ts";
import { NeedsMe } from "./panels/NeedsMe/NeedsMe.tsx";
import { Proposal } from "./panels/Proposal/Proposal.tsx";
import { PROPOSAL_TITLE, PROPOSAL_PANEL, ProposalParams, proposalResolves, proposalRestores } from "./panels/Proposal/proposal-params.ts";
import { EmptyActivity } from "./panels/EmptyActivity/EmptyActivity.tsx";
import { Desk } from "./panels/Desk/Desk.tsx";
import { Item } from "./panels/Item/Item.tsx";
import { ITEM_PANEL, ITEM_TITLE, ItemParams, itemTabSaved } from "./panels/Item/item-params.ts";

/** An activity that isn't built yet: its sidebar panel shows its empty state. */
const unbuilt = (id: string, title: string, icon: LucideIcon, emptyState: NonNullable<ActivityDescriptor["emptyState"]>): void => {
  const sidebarPanel = `${id}-empty`;
  registerActivity({ id, title, icon, sidebarPanel, emptyState });
  registerPanel({ id: sidebarPanel, title, icon, locations: ["left"], activity: id, component: () => createElement(EmptyActivity, { ...emptyState, heading: title }) });
};

const register = (): void => {
  registerActivity({ id: AGENTS_ACTIVITY, title: "Agents", icon: Bot, sidebarPanel: "agents-list" });
  registerPanel({ id: "agents-list", title: "Agents", icon: List, locations: ["left"], activity: AGENTS_ACTIVITY, component: AgentsList });
  registerPanel({
    id: CHAT_PANEL,
    title: chatTitle,
    icon: MessageSquare,
    locations: ["editor"],
    activity: AGENTS_ACTIVITY,
    component: Chat,
    paramsSchema: ChatParams,
    resolves: chatResolves,
  });

  registerPanel({
    id: DIFF_PANEL,
    // The panel reports "<file name> (diff)" once it has read the request (the agents list doesn't name the file).
    title: DIFF_TITLE,
    icon: Columns2,
    locations: ["editor"],
    activity: AGENTS_ACTIVITY,
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
    locations: ["editor"],
    component: Proposal,
    paramsSchema: ProposalParams,
    resolves: proposalResolves,
    restores: proposalRestores,
  });

  registerPanel({ id: "needs-me", title: "Needs me", icon: Inbox, locations: ["right"], component: NeedsMe });

  registerActivity({ id: DESK_ACTIVITY, title: "Desk", icon: LibraryBig, sidebarPanel: DESK_PANEL });
  registerPanel({ id: DESK_PANEL, title: "Desk", icon: LibraryBig, locations: ["left"], activity: DESK_ACTIVITY, component: Desk });
  registerPanel({
    id: ITEM_PANEL,
    // The panel reports the item's handle and title once it has read the item.
    title: ITEM_TITLE,
    icon: FileText,
    locations: ["editor"],
    activity: DESK_ACTIVITY,
    component: Item,
    paramsSchema: ItemParams,
    saves: itemTabSaved,
  });

  unbuilt("files", "Files", Files, { title: "Files arrive in step 9", body: "Browse and edit the workspace's files here." });
  unbuilt("source-control", "Source control", GitBranch, { title: "Source control arrives in step 10", body: "Review changes, commit and switch branches here." });
  unbuilt("project-overview", "Project overview", LayoutDashboard, { title: "Project overview arrives later", body: "See the project's codebase and what's being worked on here." });
};

// The registry lives as long as the page and refuses an id twice, so a second copy of this module (a hot update in
// development) mustn't register again: it reloads the page instead. `hot.data` outlives each copy of the module.
const hot = import.meta.hot as { data: { registered?: boolean } } | undefined;
if (hot?.data.registered === true) location.reload();
else {
  register();
  if (hot) hot.data.registered = true;
}
