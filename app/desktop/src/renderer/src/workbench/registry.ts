// Every view and activity is registered here once; the shell, the saved layout and the tabs read them from here.
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { AgentSummary } from "@wombat/shared/api";
import type { IsKnown } from "./layout.ts";

export type ViewLocation = "left" | "editor" | "right";
/** What `resolves` may look at; `agents` is undefined while the list is loading (a tab is then kept). */
export type ResolveContext = { agents: AgentSummary[] | undefined };

export type ViewDescriptor = {
  id: string;
  title: string | ((params: unknown) => string);
  icon: LucideIcon;
  locations: ViewLocation[];
  activity?: string;
  component: ComponentType<{ params: unknown }>;
  paramsSchema?: ZodType;
  resolves?: (params: unknown, ctx: ResolveContext) => boolean;
};

export type ActivityDescriptor = {
  id: string;
  title: string;
  icon: LucideIcon;
  sidebarView: string;
  emptyState?: { title: string; body: string };
};

const views = new Map<string, ViewDescriptor>();
const activityList = new Map<string, ActivityDescriptor>();

const addOnce = <T extends { id: string }>(registry: Map<string, T>, kind: string, item: T): void => {
  if (registry.has(item.id)) throw new Error(`The ${kind} "${item.id}" is registered twice; give one of them another id.`);
  registry.set(item.id, item);
};

export const registerView = (view: ViewDescriptor): void => addOnce(views, "view", view);
export const registerActivity = (activity: ActivityDescriptor): void => addOnce(activityList, "activity", activity);
export const getView = (id: string): ViewDescriptor | undefined => views.get(id);
export const getActivity = (id: string): ActivityDescriptor | undefined => activityList.get(id);
/** The activities in registration order. */
export const activities = (): ActivityDescriptor[] => [...activityList.values()];
export const viewsFor = (location: ViewLocation): ViewDescriptor[] => [...views.values()].filter((view) => view.locations.includes(location));

/** A view's title for these params. */
export const viewTitle = (view: ViewDescriptor, params: unknown): string => (typeof view.title === "string" ? view.title : view.title(params));

/** Whether a saved tab still applies: its view is registered, its params pass paramsSchema, and resolves is true. */
export const isKnown =
  (ctx: ResolveContext): IsKnown =>
  (viewId, params) => {
    const view = views.get(viewId);
    if (view === undefined) return false;
    if (view.paramsSchema !== undefined && !view.paramsSchema.safeParse(params).success) return false;
    return view.resolves === undefined || view.resolves(params, ctx);
  };
