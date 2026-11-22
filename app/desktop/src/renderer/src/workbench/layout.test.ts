// The saved layout: a saved
// layout with unknown panels or deleted agents restores without them, and one that can't be read gives the default.
// A new item's draft tab is never saved, and never restored from a layout that holds one.
import type { SerializedDockview } from "dockview-react";
import fc from "fast-check";
import { afterEach, describe, expect, test, vi } from "vitest";

import "./activities.ts";
import { DESK_ACTIVITY } from "./activity-ids.ts";
import { DEFAULT_DESK, defaultLayout, type DeskLayout, deskOf, type IsKnown, layoutActivityStates, layoutToSave, pruneLayout, restoreLayout, SavedLayout } from "./layout.ts";
import { ITEM_PANEL } from "./items/item-params.ts";
import { activities, isKnown as registryIsKnown, isRestorable, isSaved } from "./registry.ts";
import { summary } from "../../../../test/summaries.ts";

type Leaf = { type: "leaf"; data: { id: string; views: string[]; activeView?: string }; size: number };
type Branch = { type: "branch"; data: (Leaf | Branch)[]; size: number };
type Panel = { id: string; contentComponent: string; title: string; params: { panelId: string; params: unknown } };

const panel = (panelId: string, params: Record<string, unknown> = {}): Panel => ({
  id: `${panelId}:${JSON.stringify(params)}`,
  contentComponent: "panel",
  title: panelId,
  params: { panelId, params },
});
const leaf = (id: string, panels: Panel[], activeView = panels[0]?.id): Leaf => ({
  type: "leaf",
  data: { id, views: panels.map((p) => p.id), ...(activeView === undefined ? {} : { activeView }) },
  size: 400,
});
const dockview = (root: Branch, panels: Panel[], activeGroup?: string): SerializedDockview =>
  ({
    grid: { root, width: 1200, height: 800, orientation: "HORIZONTAL" },
    panels: Object.fromEntries(panels.map((p) => [p.id, p])),
    ...(activeGroup === undefined ? {} : { activeGroup }),
  }) as unknown as SerializedDockview;

/** The activity a layout falls back to: the first registered. */
const defaultActivity = (): string => {
  const [first] = activities();
  if (first === undefined) throw new Error("no activities registered");
  return first.id;
};

// Invented agents: a1 exists, a-gone was deleted since the layout was saved.
const chatA1 = panel("chat", { agentId: "a1" });
const chatA2 = panel("chat", { agentId: "a2" });
const chatGone = panel("chat", { agentId: "a-gone" });
const oldPanel = panel("old-panel-from-a-newer-app", { id: 7 });

/** Two groups side by side: [chatA1, oldPanel (active)] and [chatGone] (active group), with a nested split [chatA2]; the Desk showing a binder's view with two drawers open. */
const savedSplit = (): SavedLayout => ({
  version: 2,
  dockview: dockview(
    {
      type: "branch",
      size: 800,
      data: [leaf("g1", [chatA1, oldPanel], oldPanel.id), leaf("g2", [chatGone]), { type: "branch", size: 400, data: [leaf("g3", [chatA2])] }],
    },
    [chatA1, oldPanel, chatGone, chatA2],
    "g2",
  ),
  sidebars: { left: 280, right: 320, rightCollapsed: true },
  activity: DESK_ACTIVITY,
  desk: { binderId: "backlog", view: "By owner", openDrawers: ["work", "work/archive"] },
});

/** What a restore asks: the registry, with the agents that exist now (a1, a2). */
const isKnown = (): IsKnown => registryIsKnown({ agents: [summary("a1"), summary("a2")] });

// Every leaf in a serialized grid.
const leaves = (node: Leaf | Branch): Leaf[] => (node.type === "leaf" ? [node] : node.data.flatMap(leaves));
const branches = (node: Leaf | Branch): Branch[] => (node.type === "leaf" ? [] : [node, ...node.data.flatMap(branches)]);
const rootOf = (layout: SavedLayout): Branch => (layout.dockview.grid.root as unknown as Branch);
const panelIds = (layout: SavedLayout): string[] => Object.keys(layout.dockview.panels).sort();

describe("pruneLayout", () => {

  test("an unknown panel and a deleted agent's tab are dropped, with the group they leave empty; active panel, group and activity are fixed", () => {
    const pruned = pruneLayout({ ...savedSplit(), activity: "an-activity-that-is-gone" }, isKnown());
    expect(panelIds(pruned)).toEqual([chatA1.id, chatA2.id].sort());
    const groups = leaves(rootOf(pruned));
    expect(groups.map((g) => g.data.id).sort()).toEqual(["g1", "g3"]);
    const g1 = groups.find((g) => g.data.id === "g1");
    expect(g1?.data.views).toEqual([chatA1.id]);
    expect(g1?.data.activeView).toBe(chatA1.id);
    expect([undefined, "g1", "g3"]).toContain(pruned.dockview.activeGroup);
    expect(pruned.activity).toBe(defaultActivity());
    expect(pruned.sidebars).toEqual(savedSplit().sidebars);
    expect(SavedLayout.safeParse(pruned).success).toBe(true);
  });

  // Random layouts (nested splits, several tabs per group) and any set of tabs that still apply.
  test("whatever is dropped, what's left is consistent: kept tabs in their groups in order, no empty leftovers, valid actives", () => {
    const panelChoices = ["chat", "files-empty", "old-panel"];
    const layout = fc
      .array(fc.array(fc.tuple(fc.constantFrom(...panelChoices), fc.constantFrom("a1", "a2", "a3", "a4")), { minLength: 1, maxLength: 4 }), {
        minLength: 1,
        maxLength: 4,
      })
      .chain((groups) => {
        const seen = new Set<string>();
        const panelsPerGroup = groups
          .map((tabs) => tabs.map(([panelId, agentId]) => panel(panelId, { agentId })).filter((p) => !seen.has(p.id) && Boolean(seen.add(p.id))))
          .filter((tabs) => tabs.length > 0);
        const all = panelsPerGroup.flat();
        return fc.record({
          groups: fc.constant(panelsPerGroup),
          nest: fc.boolean(),
          actives: fc.tuple(...panelsPerGroup.map((tabs) => fc.nat({ max: tabs.length - 1 }))),
          activeGroup: fc.nat({ max: panelsPerGroup.length - 1 }),
          keep: fc.tuple(...all.map(() => fc.boolean())),
          all: fc.constant(all),
        });
      });

    fc.assert(
      fc.property(layout, ({ groups, nest, actives, activeGroup, keep, all }) => {
        const groupLeaves = groups.map((tabs, i) => leaf(`g${String(i)}`, tabs, tabs[actives[i] ?? 0]?.id));
        const children: (Leaf | Branch)[] =
          nest && groupLeaves.length > 1 ? [groupLeaves[0] as Leaf, { type: "branch", size: 400, data: groupLeaves.slice(1) }] : groupLeaves;
        const saved: SavedLayout = {
          version: 2,
          dockview: dockview({ type: "branch", size: 800, data: children }, all, `g${String(activeGroup)}`),
          sidebars: { left: 250, right: 300, rightCollapsed: false },
          activity: defaultActivity(),
        };
        const kept = new Set(all.filter((_, i) => keep[i]).map((p) => p.id));
        const known: IsKnown = (panelId, params) => kept.has(panel(panelId, params as Record<string, unknown>).id);

        const pruned = pruneLayout(structuredClone(saved), known);

        expect(panelIds(pruned)).toEqual([...kept].sort());
        const after = new Map(leaves(rootOf(pruned)).map((g) => [g.data.id, g]));
        groupLeaves.forEach((before) => {
          const survivors = before.data.views.filter((id) => kept.has(id));
          const now = after.get(before.data.id);
          if (survivors.length === 0) {
            expect(now, `group ${before.data.id} was left empty but kept`).toBeUndefined();
            return;
          }
          expect(now?.data.views).toEqual(survivors);
          if (before.data.activeView !== undefined && kept.has(before.data.activeView)) expect(now?.data.activeView).toBe(before.data.activeView);
          else expect(survivors).toContain(now?.data.activeView);
        });
        const wasActive = `g${String(activeGroup)}`;
        if (after.has(wasActive)) expect(pruned.dockview.activeGroup).toBe(wasActive);
        else if (pruned.dockview.activeGroup !== undefined) expect(after.has(pruned.dockview.activeGroup)).toBe(true);
        if (kept.size > 0) {
          expect(branches(rootOf(pruned)).filter((b) => b.data.length === 0), "an empty split is left").toEqual([]);
          expect(SavedLayout.safeParse(pruned).success).toBe(true);
        }
      }),
    );
  });
});

describe("restoreLayout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Every argument in full, the way console would show it: an error with its message, stack and causes, any other
  // value as JSON (node:util's inspect isn't available: the renderer's tests are typed without Node).
  const format = (arg: unknown): string => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}${arg.cause === undefined ? "" : ` cause: ${format(arg.cause)}`}`;
    try {
      return JSON.stringify(arg) ?? String(arg);
    } catch {
      return String(arg);
    }
  };

  /** console.warn's calls during `run`, silenced. */
  const warnings = (run: () => void): string[] => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(format).join(" "));
    });
    run();
    return lines;
  };

  test("a saved layout read back from settings restores to the same panes, tabs, sidebars, activity and Desk", () => {
    const saved = savedSplit();
    const applied: SerializedDockview[] = [];
    let restored: SavedLayout | undefined;
    const warned = warnings(() => {
      restored = restoreLayout(JSON.parse(JSON.stringify(saved)), () => true, (d) => applied.push(d));
    });
    expect(restored).toEqual(saved);
    expect(applied).toEqual([saved.dockview]);
    expect(warned).toEqual([]);
  });

  // Content that must never reach the warning: a marker in the layout, and in what dockview throws.
  const MARKER = "agent-marker-5f3e";
  const marked = (): SavedLayout => {
    const saved = savedSplit();
    const tab = panel("chat", { agentId: MARKER });
    return { ...saved, dockview: dockview({ type: "branch", size: 800, data: [leaf("g1", [tab])] }, [tab], "g1") };
  };

  test.each<[string, () => unknown]>([
    ["nothing saved yet", () => undefined],
    ["not JSON-shaped", () => `{"version":1,"dockview":"${MARKER}`],
    ["another version", () => ({ ...marked(), version: 3 })],
  ])("a layout that can't be read gives the default, with one warning that holds no layout content: %s", (_name, raw) => {
    const applied: SerializedDockview[] = [];
    let restored: SavedLayout | undefined;
    const warned = warnings(() => {
      restored = restoreLayout(raw(), () => true, (d) => applied.push(d));
    });
    expect(restored).toEqual(defaultLayout());
    expect(JSON.stringify(applied), "corrupt content was handed to dockview").not.toContain(MARKER);
    // Nothing saved yet isn't a failure worth a warning; anything else is one warning.
    if (raw() !== undefined) expect(warned).toHaveLength(1);
    expect(warned.join("\n")).not.toContain(MARKER);
  });

  test("dockview refusing the layout gives the default, with one warning that holds no layout content", () => {
    let restored: SavedLayout | undefined;
    let calls = 0;
    const warned = warnings(() => {
      restored = restoreLayout(JSON.parse(JSON.stringify(marked())), () => true, (d) => {
        calls++;
        if (JSON.stringify(d).includes(MARKER)) throw new Error(`Invalid grid element for panel ${MARKER}`);
      });
    });
    expect(calls).toBeGreaterThan(0);
    expect(restored).toEqual(defaultLayout());
    expect(warned).toHaveLength(1);
    expect(warned.join("\n")).not.toContain(MARKER);
  });
});

describe("the Desk's state in a layout", () => {
  test("reaches the Desk through its activity's slot and is saved back from it unchanged; a layout without one gives the default", () => {
    const deskArb: fc.Arbitrary<DeskLayout> = fc.record({ binderId: fc.string(), view: fc.string(), openDrawers: fc.array(fc.string()) }, { requiredKeys: ["openDrawers"] });
    fc.assert(
      fc.property(fc.option(deskArb, { nil: undefined }), (desk) => {
        const layout: SavedLayout = { ...defaultLayout(), ...(desk === undefined ? {} : { desk }) };
        const states = layoutActivityStates(layout);
        expect(deskOf(states[DESK_ACTIVITY]), "what the Desk reads").toEqual(desk ?? DEFAULT_DESK);
        expect(layoutToSave(layout.dockview, layout, states).desk, "what the layout saves").toEqual(desk ?? DEFAULT_DESK);
      }),
    );
  });
});

describe("a draft item tab", () => {
  const item = panel(ITEM_PANEL, { ws: "ws-tasks00001", binderId: "tasks", itemId: "0196f3c2-3f00-7000-8000-000000000001" });
  const draft = panel(ITEM_PANEL, { ws: "ws-tasks00001", binderId: "tasks", draft: "draft-1", context: { status: "todo" } });
  const withDraft = (): SavedLayout => ({
    ...savedSplit(),
    dockview: dockview({ type: "branch", size: 800, data: [leaf("g1", [chatA1, item, draft], draft.id)] }, [chatA1, item, draft], "g1"),
  });

  test("is left out of the layout the workbench saves", () => {
    expect(panelIds(pruneLayout(withDraft(), isSaved))).toEqual([chatA1.id, item.id].sort());
  });

  test("is left out when a layout holding one is restored", () => {
    const restored = restoreLayout(JSON.parse(JSON.stringify(withDraft())), isRestorable({ agents: [summary("a1")] }), () => undefined);
    expect(panelIds(restored)).toEqual([chatA1.id, item.id].sort());
  });
});
