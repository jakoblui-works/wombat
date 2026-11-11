// Importing this module registers the activities and their views, in the activity bar's order (Agents first).
import { Bot, Files, Inbox, FolderCog, GitBranch, LayoutDashboard, List, MessageSquare, type LucideIcon } from "lucide-react";
import { createElement } from "react";

import { type ActivityDescriptor, registerActivity, registerView } from "./registry.ts";
import { AgentsList } from "./views/AgentsList/AgentsList.tsx";
import { Chat } from "./views/Chat/Chat.tsx";
import { ChatParams, chatResolves, chatTitle } from "./views/Chat/chat-params.ts";
import { NeedsMe } from "./views/NeedsMe/NeedsMe.tsx";
import { EmptyActivity } from "./views/EmptyActivity/EmptyActivity.tsx";

export const AGENTS_ACTIVITY = "agents";

/** An activity that isn't built yet: its sidebar view shows its empty state. */
const unbuilt = (id: string, title: string, icon: LucideIcon, emptyState: NonNullable<ActivityDescriptor["emptyState"]>): void => {
  const sidebarView = `${id}-empty`;
  registerActivity({ id, title, icon, sidebarView, emptyState });
  registerView({ id: sidebarView, title, icon, locations: ["left"], activity: id, component: () => createElement(EmptyActivity, { ...emptyState, heading: title }) });
};

const register = (): void => {
  registerActivity({ id: AGENTS_ACTIVITY, title: "Agents", icon: Bot, sidebarView: "agents-list" });
  registerView({ id: "agents-list", title: "Agents", icon: List, locations: ["left"], activity: AGENTS_ACTIVITY, component: AgentsList });
  registerView({
    id: "chat",
    title: chatTitle,
    icon: MessageSquare,
    locations: ["editor"],
    activity: AGENTS_ACTIVITY,
    component: Chat,
    paramsSchema: ChatParams,
    resolves: chatResolves,
  });

  registerView({ id: "needs-me", title: "Needs me", icon: Inbox, locations: ["right"], component: NeedsMe });

  unbuilt("files", "Files", Files, { title: "Files arrive in step 9", body: "Browse and edit the workspace's files here." });
  unbuilt("source-control", "Source control", GitBranch, { title: "Source control arrives in step 10", body: "Review changes, commit and switch branches here." });
  unbuilt("workspace", "Workspace", FolderCog, { title: "Workspace arrives in step 8", body: "See the workspace's repos and settings here." });
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
