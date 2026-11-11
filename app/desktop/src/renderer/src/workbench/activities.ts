// Importing this module registers the activities and their views, in the activity bar's order (Agents first).
import { Bot, Files, FolderCog, GitBranch, LayoutDashboard, List, MessageSquare, type LucideIcon } from "lucide-react";
import { createElement } from "react";

import { type ActivityDescriptor, registerActivity, registerView } from "./registry.ts";
import { AgentsList } from "./views/AgentsList/AgentsList.tsx";
import { Chat } from "./views/Chat/Chat.tsx";
import { ChatParams, chatResolves, chatTitle } from "./views/Chat/chat-params.ts";
import { EmptyState } from "./views/EmptyState/EmptyState.tsx";

export const AGENTS_ACTIVITY = "agents";

/** An activity that isn't built yet: its sidebar view shows its empty state. */
const unbuilt = (id: string, title: string, icon: LucideIcon, emptyState: NonNullable<ActivityDescriptor["emptyState"]>): void => {
  const sidebarView = `${id}-empty`;
  registerActivity({ id, title, icon, sidebarView, emptyState });
  registerView({ id: sidebarView, title, icon, locations: ["left"], activity: id, component: () => createElement(EmptyState, emptyState) });
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

  unbuilt("files", "Files", Files, { title: "Files", body: "Browsing and editing the workspace's files comes in step 9." });
  unbuilt("source-control", "Source control", GitBranch, { title: "Source control", body: "Changes, commits and branches come in step 10." });
  unbuilt("workspace", "Workspace", FolderCog, { title: "Workspace", body: "The workspace's repos and settings come in step 8." });
  unbuilt("project-overview", "Project overview", LayoutDashboard, { title: "Project overview", body: "An overview of the project comes later." });
};

// The registry lives as long as the page and refuses an id twice, so a second copy of this module (a hot update in
// development) mustn't register again: it reloads the page instead. `hot.data` outlives each copy of the module.
const hot = import.meta.hot as { data: { registered?: boolean } } | undefined;
if (hot?.data.registered === true) location.reload();
else {
  register();
  if (hot) hot.data.registered = true;
}
