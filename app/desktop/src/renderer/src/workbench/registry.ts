// Every tab's panel and every activity is registered here once; the shell, its saved state and the tabs read them from here.
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { AgentSummary } from "@wombat/shared/api";
import type { Proposal } from "@wombat/shared/proposals";

/** A rule on a tab, as `isKnown`, `isSaved` and `isRestorable` answer. */
export type TabTest = (panelId: string, params: unknown) => boolean;

/** What decides whether a tab still applies; a list is undefined while it's loading (or couldn't be read). */
export type ResolveContext = {
  agents: AgentSummary[] | undefined;
  proposals?: readonly Proposal[] | undefined;
};
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
   * Replaces the registered `title` for this tab, until it closes, once the panel knows a better one.
   */
  setTitle?: ((title: string) => void) | undefined;
};

/** A tab's panel. */
export type PanelDescriptor = {
  id: string;
  title: string;
  activity?: string;
  /** The right sidebar's width, in pixels, this panel wants as the active tab. */
  wants?: number;
  component: ComponentType<PanelProps>;
  paramsSchema?: ZodType;
  resolves?: (params: unknown, ctx: KnownContext) => boolean;
  /** Whether a saved tab comes back at the next start, on top of `resolves` (checked only by the restore). */
  restores?: (params: unknown, ctx: KnownContext) => boolean;
  /** Whether an open tab is saved with the shell (default: yes); a tab that isn't is never restored either. */
  saves?: (params: unknown) => boolean;
};

/** A navigator shows workspace `ws`'s list (one per workspace, all mounted); `onRevealed` as for a panel. */
export type NavigatorProps = { ws: string } & Pick<PanelProps, "reveal" | "onRevealed">;

/** One object feeds both `registerActivity` and `useActivityState`, so the hook's type is the registered schema's. */
export type ActivityStateOf<T> = { id: string; state: { schema: ZodType<T>; initial: T } };

export type ActivityDescriptor<T = unknown> = {
  id: string;
  title: string;
  icon: LucideIcon;
  /**
   * The navigator shown beside the activity's tabs. `wants` is the right sidebar's width, in pixels, it wants alone.
   */
  navigator: { component: ComponentType<NavigatorProps>; wants?: number };
  /** Its state in each workspace, saved with the shell: `initial` until changed, and again when the saved one doesn't parse. */
  state?: { schema: ZodType<T>; initial: T };
};

const panels = new Map<string, PanelDescriptor>();
const activityList = new Map<string, ActivityDescriptor>();

const addOnce = <T extends { id: string }>(registry: Map<string, T>, kind: string, item: T): void => {
  if (registry.has(item.id)) throw new Error(`The ${kind} "${item.id}" is registered twice; give one of them another id.`);
  registry.set(item.id, item);
};

export const registerPanel = (panel: PanelDescriptor): void => addOnce(panels, "panel", panel);
export const registerActivity = <T>(activity: ActivityDescriptor<T>): void => addOnce<ActivityDescriptor>(activityList, "activity", activity);
export const getPanel = (id: string): PanelDescriptor | undefined => panels.get(id);
export const getActivity = (id: string): ActivityDescriptor | undefined => activityList.get(id);
/** The activities in registration order. */
export const activities = (): ActivityDescriptor[] => [...activityList.values()];

/** Whether `params` pass the panel's paramsSchema (a panel without one takes any). */
export const paramsFit = (panel: PanelDescriptor, params: unknown): boolean => panel.paramsSchema === undefined || panel.paramsSchema.safeParse(params).success;

/**
 * Whether a tab still applies: its panel is registered, its params fit, and, once the agents list is known, its
 * resolves is true. While the list is unknown a tab is kept.
 */
export const isKnown =
  ({ agents, proposals }: ResolveContext): TabTest =>
  (panelId, params) => {
    const panel = panels.get(panelId);
    if (panel === undefined || !paramsFit(panel, params)) return false;
    return agents === undefined || panel.resolves === undefined || panel.resolves(params, { agents, proposals });
  };

/** Whether an open tab goes into the saved shell: its panel's `saves`. */
export const isSaved: TabTest = (panelId, params) => panels.get(panelId)?.saves?.(params) ?? true;

/**
 * Whether a saved tab comes back at the next start: `isKnown` and `isSaved`, plus, once the agents list is known, its panel's
 * `restores` (a diff tab of an answered request isn't restored).
 */
export const isRestorable =
  (ctx: ResolveContext): TabTest =>
  (panelId, params) => {
    if (!isKnown(ctx)(panelId, params) || !isSaved(panelId, params)) return false;
    const restores = panels.get(panelId)?.restores;
    return ctx.agents === undefined || restores === undefined || restores(params, { agents: ctx.agents, proposals: ctx.proposals });
  };
