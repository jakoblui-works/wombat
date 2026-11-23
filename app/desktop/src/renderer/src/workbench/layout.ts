// The layout the user left, saved per workspace through settings.set({ layout }) and restored once on load.
import type { SerializedDockview } from "dockview-react";
import { z } from "zod";
import { DESK_ACTIVITY } from "./activity-ids.ts";
import { activityOrDefault } from "./registry.ts";
import type { ActivityStates } from "./workbench-context.ts";

/** Whether a saved tab still applies: its panel is registered and its params pass paramsSchema and resolves. */
export type IsKnown = (panelId: string, params: unknown) => boolean;

export type SavedLayout = {
  version: 2;
  dockview: SerializedDockview;
  sidebars: { left: number; right: number; rightCollapsed: boolean };
  activity: string;
  desk?: DeskLayout;
};

/** The Desk as the user left it: the binder (and view) shown in its sidebar, and the open drawers' folders. */
export type DeskLayout = { binderId?: string; view?: string; openDrawers: string[] };

/** The Desk until the user changes it: the tree, every drawer closed. */
export const DEFAULT_DESK: Readonly<DeskLayout> = { openDrawers: [] };

export const DeskLayout = z.object({ binderId: z.string().exactOptional(), view: z.string().exactOptional(), openDrawers: z.array(z.string()) });

/**
 * The Desk's slot holds only what `layoutActivityStates`, the shell's restore (both parse it) and the Desk wrote, so
 * it's trusted as it is; an empty slot is `DEFAULT_DESK`.
 */
export const deskOf = (slot: unknown): DeskLayout => (slot === undefined ? DEFAULT_DESK : (slot as DeskLayout));

/** The activities' states a layout restores: the Desk's as saved, else `DEFAULT_DESK`. */
export const layoutActivityStates = (layout: Pick<SavedLayout, "desk">): ActivityStates => ({ [DESK_ACTIVITY]: deskOf(layout.desk) });

export const layoutToSave = (
  dockview: SerializedDockview,
  { sidebars, activity }: Pick<SavedLayout, "sidebars" | "activity">,
  states: ActivityStates,
): SavedLayout & { desk: DeskLayout } => ({ version: 2, dockview, sidebars, activity, desk: deskOf(states[DESK_ACTIVITY]) });

/** The activity `id` names if it's registered, else the default (Agents). */
const knownActivity = (id: string | undefined): string => activityOrDefault(id)?.id ?? "";
/** The sidebars' widths (px) and state until the user changes them. */
export const DEFAULT_SIDEBARS: Readonly<SavedLayout["sidebars"]> = { left: 280, right: 296, rightCollapsed: true };
const DEFAULT_GROUP_ID = "editor";

type GridNode = { type: "leaf"; data: { id: string; views: string[]; activeView?: string | undefined } } | { type: "branch"; data: GridNode[] };

const GridNode: z.ZodType<GridNode> = z.lazy(() =>
  z.union([
    z.looseObject({
      type: z.literal("leaf"),
      data: z.looseObject({ id: z.string(), views: z.array(z.string()), activeView: z.string().optional() }),
    }),
    z.looseObject({ type: z.literal("branch"), data: z.array(GridNode) }),
  ]),
);

/** A tab's panel as the workbench saves it: dockview's panel state, its params the panel and the panel's params. */
const SavedPanel = z.looseObject({ id: z.string(), params: z.looseObject({ panelId: z.string(), params: z.unknown() }) });

// Only the structure the restore relies on is checked; dockview checks the rest in fromJSON.
const SerializedDockviewShape = z.looseObject({
  grid: z.looseObject({ root: GridNode }),
  panels: z.record(z.string(), SavedPanel),
  activeGroup: z.string().optional(),
});

/** The saved layout's schema; `dockview` is checked for structure only (panels, grid). */
export const SavedLayout: z.ZodType<SavedLayout> = z
  .object({
    version: z.literal(2),
    dockview: SerializedDockviewShape,
    sidebars: z.object({ left: z.number(), right: z.number(), rightCollapsed: z.boolean() }),
    activity: z.string(),
    desk: DeskLayout.exactOptional(),
  })
  .transform((layout) => layout as unknown as SavedLayout);

const emptyGroup = (): GridNode & { size: number } => ({ type: "leaf", data: { id: DEFAULT_GROUP_ID, views: [] }, size: 0 });

const defaultDockview = (): SerializedDockview =>
  ({
    // dockview lays the grid out to its own size on fromJSON, so the saved sizes here don't matter.
    grid: { root: { type: "branch", data: [emptyGroup()], size: 0 }, width: 0, height: 0, orientation: "HORIZONTAL" },
    panels: {},
  }) as unknown as SerializedDockview;

/** The default layout: one empty group, the Agents activity, default sidebar widths. */
export const defaultLayout = (): SavedLayout => ({ version: 2, dockview: defaultDockview(), sidebars: { ...DEFAULT_SIDEBARS }, activity: knownActivity(undefined) });

/** The grid without the dropped tabs; a group (or split) pruning emptied is removed, one that was empty stays. */
const pruneNode = (node: GridNode, kept: (panelId: string) => boolean): GridNode | undefined => {
  if (node.type === "leaf") {
    const views = node.data.views.filter(kept);
    if (views.length === 0 && node.data.views.length > 0) return undefined;
    const { activeView } = node.data;
    const data = { ...node.data, views };
    delete data.activeView;
    const active = activeView !== undefined && views.includes(activeView) ? activeView : views[0];
    return { ...node, data: active === undefined ? data : { ...data, activeView: active } };
  }
  const children = node.data.flatMap((child) => pruneNode(child, kept) ?? []);
  return children.length === 0 && node.data.length > 0 ? undefined : { ...node, data: children };
};

const groupIds = (node: GridNode): string[] => (node.type === "leaf" ? [node.data.id] : node.data.flatMap(groupIds));

/** Drops tabs that no longer apply, groups they leave empty, and fixes the active panel and group and the activity. */
export const pruneLayout = (saved: SavedLayout, isKnown: IsKnown): SavedLayout => {
  const { panels, grid, activeGroup } = saved.dockview;
  const dockview = { ...saved.dockview };
  // The workbench uses no floating, popout or edge groups; any in a saved layout are dropped rather than checked.
  delete dockview.floatingGroups;
  delete dockview.popoutGroups;
  delete dockview.edgeGroups;
  delete dockview.activeGroup;
  const keptPanels = Object.fromEntries(
    Object.entries(panels).filter(([, panel]) => {
      const parsed = SavedPanel.safeParse(panel);
      return parsed.success && isKnown(parsed.data.params.panelId, parsed.data.params.params);
    }),
  );
  const pruned = pruneNode(grid.root as GridNode, (id) => id in keptPanels);
  // Nothing left at all: the default's one empty group.
  const root = pruned !== undefined && groupIds(pruned).length > 0 ? pruned : (defaultDockview().grid.root as GridNode);
  const groups = groupIds(root);
  const active = activeGroup !== undefined && groups.includes(activeGroup) ? activeGroup : activeGroup === undefined ? undefined : groups[0];
  return {
    ...saved,
    dockview: { ...dockview, grid: { ...grid, root: root as SerializedDockview["grid"]["root"] }, panels: keptPanels, ...(active === undefined ? {} : { activeGroup: active }) },
    activity: knownActivity(saved.activity),
  };
};

/**
 * Parses, prunes and applies `raw` (`apply` is dockview's fromJSON); returns the layout now in effect. Anything that
 * fails (parse, prune, apply throwing) gives `defaultLayout()` and one console warning without layout content, and
 * calls `onFallback` (the saved layout is still there, and mustn't be overwritten by the default unasked).
 */
export const restoreLayout = (
  raw: unknown,
  isKnown: IsKnown,
  apply: (dockview: SerializedDockview) => void,
  onFallback?: () => void,
): SavedLayout => {
  if (raw !== undefined) {
    try {
      const layout = pruneLayout(SavedLayout.parse(raw), isKnown);
      apply(layout.dockview);
      return layout;
    } catch {
      // Neither the error nor the layout: both can hold agent ids, paths and titles.
      console.warn("Wombat couldn't restore the saved layout; it opens with the default one.");
      onFallback?.();
    }
  }
  const fallback = defaultLayout();
  apply(fallback.dockview);
  return fallback;
};
