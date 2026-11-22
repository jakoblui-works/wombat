// Every panel and activity is registered here once; the shell, the saved layout and the tabs read them from here.
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { z, type ZodType } from "zod";
import type { AgentSummary } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";
import type { IsKnown } from "./layout.ts";

export type PanelLocation = "tab" | "navigator";
/** What a panel's title may look at; a list is undefined while it's loading (or couldn't be read). */
export type ResolveContext = { agents: AgentSummary[] | undefined; proposals?: readonly Proposal[] | undefined };
/**
 * What `resolves` looks at: it's only asked once the agents list is known (until then a tab is kept). The proposals
 * may still be unknown: a panel that goes by them keeps its tab until they are.
 */
export type KnownContext = { agents: AgentSummary[]; proposals: readonly Proposal[] | undefined };

/**
 * Asks a tab's panel to show something in it (a permission request to scroll to). Every request is a new object, so
 * asking for the same target twice reaches the panel twice.
 */
export type Reveal = { target: string };

export type PanelProps = {
  params: unknown;
  reveal?: Reveal | undefined;
  /** For a sidebar panel: called once it has shown `reveal` or given up on it, which is then forgotten (no replay when it shows again). */
  onRevealed?: (() => void) | undefined;
  /**
   * For a panel whose tab title needs more than the agents list (the diff tab's file name, from the log): the title it
   * reports takes the place of its `title` for this tab until the tab closes.
   */
  setTitle?: ((title: string) => void) | undefined;
};

export type PanelDescriptor = {
  id: string;
  title: string | ((params: unknown, ctx: ResolveContext) => string);
  icon: LucideIcon;
  locations: PanelLocation[];
  activity?: string;
  /** The right sidebar's width, in pixels, this panel wants as the active tab, or as a navigator alone. */
  wants?: number;
  component: ComponentType<PanelProps>;
  paramsSchema?: ZodType;
  resolves?: (params: unknown, ctx: KnownContext) => boolean;
  /** Whether a saved tab comes back at the next start, on top of `resolves` (checked only by the restore). */
  restores?: (params: unknown, ctx: KnownContext) => boolean;
  /** Whether an open tab is saved with the layout (default: yes); a tab that isn't is never restored either. */
  saves?: (params: unknown) => boolean;
};

export type ActivityDescriptor = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** The panel shown beside the activity's tabs; its params are `NavigatorParams`. */
  navigator: string;
};

/** A navigator's params: the workspace whose navigator it is (one per workspace, all mounted). */
export const NavigatorParams = z.object({ ws: z.string() });
export type NavigatorParams = z.infer<typeof NavigatorParams>;

const panels = new Map<string, PanelDescriptor>();
const activityList = new Map<string, ActivityDescriptor>();

const addOnce = <T extends { id: string }>(registry: Map<string, T>, kind: string, item: T): void => {
  if (registry.has(item.id)) throw new Error(`The ${kind} "${item.id}" is registered twice; give one of them another id.`);
  registry.set(item.id, item);
};

export const registerPanel = (panel: PanelDescriptor): void => addOnce(panels, "panel", panel);
export const registerActivity = (activity: ActivityDescriptor): void => addOnce(activityList, "activity", activity);
export const getPanel = (id: string): PanelDescriptor | undefined => panels.get(id);
export const getActivity = (id: string): ActivityDescriptor | undefined => activityList.get(id);
/** The activities in registration order. */
export const activities = (): ActivityDescriptor[] => [...activityList.values()];
/** The activity `id` names, else the first registered. */
export const activityOrDefault = (id: string | undefined): ActivityDescriptor | undefined =>
  (id === undefined ? undefined : activityList.get(id)) ?? activities()[0];
export const panelsFor = (location: PanelLocation): PanelDescriptor[] => [...panels.values()].filter((panel) => panel.locations.includes(location));

/** A panel's title for these params. */
export const panelTitle = (panel: PanelDescriptor, params: unknown, ctx: ResolveContext): string =>
  typeof panel.title === "string" ? panel.title : panel.title(params, ctx);

/** Whether `params` pass the panel's paramsSchema (a panel without one takes any). */
export const paramsFit = (panel: PanelDescriptor, params: unknown): boolean => panel.paramsSchema === undefined || panel.paramsSchema.safeParse(params).success;

/**
 * Whether a tab still applies: its panel is registered, its params fit, and, once the agents list is known, its
 * resolves is true. While the list is unknown a tab is kept.
 */
export const isKnown =
  ({ agents, proposals }: ResolveContext): IsKnown =>
  (panelId, params) => {
    const panel = panels.get(panelId);
    if (panel === undefined || !paramsFit(panel, params)) return false;
    return agents === undefined || panel.resolves === undefined || panel.resolves(params, { agents, proposals });
  };

/** Whether an open tab goes into the saved layout: its panel's `saves`. */
export const isSaved: IsKnown = (panelId, params) => panels.get(panelId)?.saves?.(params) ?? true;

/**
 * Whether a saved tab comes back at the next start: `isKnown` and `isSaved`, plus, once the agents list is known, its panel's
 * `restores` (a diff tab of an answered request isn't restored).
 */
export const isRestorable =
  (ctx: ResolveContext): IsKnown =>
  (panelId, params) => {
    if (!isKnown(ctx)(panelId, params) || !isSaved(panelId, params)) return false;
    const restores = panels.get(panelId)?.restores;
    return ctx.agents === undefined || restores === undefined || restores(params, { agents: ctx.agents, proposals: ctx.proposals });
  };
