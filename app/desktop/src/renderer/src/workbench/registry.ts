// Every view and activity is registered here once; the shell, the saved layout and the tabs read them from here.
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { AgentSummary } from "@wombat/shared/api";
import type { IsKnown } from "./layout.ts";

export type ViewLocation = "left" | "editor" | "right";
/** What a view's title may look at; `agents` is undefined while the list is loading. */
export type ResolveContext = { agents: AgentSummary[] | undefined };
/** What `resolves` looks at: it's only asked once the agents list is known (until then a tab is kept). */
export type KnownContext = { agents: AgentSummary[] };

/**
 * Asks a tab's view to show something in it (a permission request to scroll to). Every request is a new object, so
 * asking for the same target twice reaches the view twice.
 */
export type Reveal = { target: string };

export type ViewProps = { params: unknown; reveal?: Reveal | undefined };

export type ViewDescriptor = {
  id: string;
  title: string | ((params: unknown, ctx: ResolveContext) => string);
  icon: LucideIcon;
  locations: ViewLocation[];
  activity?: string;
  component: ComponentType<ViewProps>;
  paramsSchema?: ZodType;
  resolves?: (params: unknown, ctx: KnownContext) => boolean;
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
/** The activity `id` names, else the first registered (Agents): what the workbench opens on. */
export const activityOrDefault = (id: string | undefined): ActivityDescriptor | undefined =>
  (id === undefined ? undefined : activityList.get(id)) ?? activities()[0];
export const viewsFor = (location: ViewLocation): ViewDescriptor[] => [...views.values()].filter((view) => view.locations.includes(location));

/** A view's title for these params. */
export const viewTitle = (view: ViewDescriptor, params: unknown, ctx: ResolveContext): string =>
  typeof view.title === "string" ? view.title : view.title(params, ctx);

/** Whether `params` pass the view's paramsSchema (a view without one takes any). */
export const paramsFit = (view: ViewDescriptor, params: unknown): boolean => view.paramsSchema === undefined || view.paramsSchema.safeParse(params).success;

/**
 * Whether a tab still applies: its view is registered, its params fit, and, once the agents list is known, its
 * resolves is true. While the list is unknown a tab is kept.
 */
export const isKnown =
  ({ agents }: ResolveContext): IsKnown =>
  (viewId, params) => {
    const view = views.get(viewId);
    if (view === undefined || !paramsFit(view, params)) return false;
    return agents === undefined || view.resolves === undefined || view.resolves(params, { agents });
  };
