// An agent's open item proposals among a binder's items: each shows exactly once in every view (a create as its own
// row, an update or delete on its item's row, the oldest as the mark, or on a row of its own when no item has its
// handle; a filter never hides one), with a line each; decided ones and other binders' never; a proposed create is
// placed by every view exactly as an item holding the same fields, its links named only by their own binder's items;
// and a reveal finds a row by any open proposal it holds. The expected rows come from these rules, by hand.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { ItemSummary, LenientProperty, LenientView, LinkValue } from "@wombat/shared/items";
import type { ItemProposalKind, ProposalStatus } from "@wombat/shared/proposals";

import { boardColumns } from "../../Board/board-columns.ts";
import { PROPOSAL_ATTRIBUTE, proposalProps } from "../use-reveal.ts";
import { isItemRow, isPending, type ItemRow, type ItemsOf, listGroups, type Row, sorted, treeRows, type TreeRow, visibleItems } from "./view-model.ts";
import { type ItemProposalRead, proposalLines, rowProposalIds, struck, withProposals } from "./with-proposals.ts";

type Properties = Record<string, LenientProperty>;

// ---- Invented binders, items and proposals ----

const CHORES = "chores";
const ERRANDS = "errands";
const PLACES = "places";
const SHEDS = "sheds";

const idIn = (block: string, n: number): string => `0196f3c2-${block}-7000-8000-${n.toString(16).padStart(12, "0")}`;

const itemOf = (prefix: string, folder: string, block: string) => (n: number, properties: Record<string, unknown> = {}): ItemSummary => ({
  id: idIn(block, n),
  handle: `${prefix}-${String(n)}`,
  aliases: [],
  title: `Invented ${folder} item ${String(n)}`,
  properties,
  path: `${folder}/${prefix}-${String(n)}.md`,
  version: n.toString(16).padStart(64, "0"),
  problems: [],
  excerpt: null,
  binder: folder,
});
const chore = itemOf("CH", CHORES, "7a00");
const placeItem = itemOf("PL", PLACES, "7b00");
const shedItem = itemOf("SH", SHEDS, "7c00");

const STATUSES: ProposalStatus[] = ["pending", "applying", "conflict", "approved", "rejected"];
const OPEN = new Set<ProposalStatus>(["pending", "applying", "conflict"]);

const proposalId = (n: number): string => idIn("7d00", n);
/** The `n`th minute of an invented morning. */
const minute = (n: number): string => new Date(Date.UTC(2026, 10, 2, 9, n)).toISOString();

type Spec = { id: string; at: string; binder: string; kind: ItemProposalKind; handle: string | null; status: ProposalStatus; fields?: Record<string, unknown> };

const proposal = ({ id, at, binder, kind, handle, status, fields }: Spec): ItemProposalRead => ({
  target: "item",
  id,
  status,
  agentId: "0196f3c2-7e00-7000-8000-00000000a9e1",
  reason: "Keeps the garden tidy.",
  version: 2,
  editedByMe: false,
  at,
  binder,
  kind,
  handle: kind === "create" ? null : handle,
  file: null,
  ...(fields === undefined ? {} : { fields }),
});

const pendingOf = (row: Row) => (isPending(row) ? row : undefined);
const itemRowOf = (row: Row): ItemRow | undefined => (isItemRow(row) ? row : undefined);

// ---- Generated binders with proposals of every kind and status, in this binder and another, and a view ----

const STAGES = ["todo", "doing", "done"] as const;
const OWN: Properties = {
  stage: { type: "select", options: [...STAGES], required: false },
  effort: { type: "number", required: false },
  parent: { type: "link", to: CHORES, required: false },
};
/** Handles no item has (its file deleted or renamed by hand). */
const GONE = ["CH-90", "CH-91"];

type Scenario = { items: ItemSummary[]; proposals: ItemProposalRead[]; view: LenientView };

const fieldsArb = fc.record({ title: fc.string({ minLength: 1, maxLength: 20 }), stage: fc.constantFrom("todo", "done"), effort: fc.integer({ min: 1, max: 3 }) }, { requiredKeys: ["title"] });

const filterArb = fc.record({ stage: fc.constantFrom(...STAGES), effort: fc.integer({ min: 1, max: 3 }) }, { requiredKeys: [] });
const viewArb: fc.Arbitrary<LenientView> = fc.oneof(
  fc.record({ name: fc.constant("List"), kind: fc.constant("list" as const), filter: filterArb, group: fc.constantFrom("stage", "effort") }, { requiredKeys: ["name", "kind"] }),
  fc.record({ name: fc.constant("Board"), kind: fc.constant("board" as const), column: fc.constant("stage"), filter: filterArb }, { requiredKeys: ["name", "kind", "column"] }),
  fc.record({ name: fc.constant("Tree"), kind: fc.constant("tree" as const), parent: fc.constant("parent"), filter: filterArb }, { requiredKeys: ["name", "kind", "parent"] }),
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 10 }).chain((numbers) => {
  const values = fc.record({ stage: fc.constantFrom(...STAGES), effort: fc.integer({ min: 1, max: 3 }), parent: fc.nat() }, { requiredKeys: [] });
  const itemsArb = fc.tuple(...numbers.map(() => values)).map((drawn) =>
    numbers.map((n, at) => {
      const { parent, ...rest } = drawn[at] ?? {};
      const under = parent === undefined ? undefined : numbers[parent % numbers.length];
      return chore(n, { ...rest, ...(under === undefined ? {} : { parent: { id: idIn("7a00", under), handle: `CH-${String(under)}` } }) });
    }),
  );
  // Another binder's proposals name the same handles: only the binder tells them apart.
  const handles = [...numbers.map((n) => `CH-${String(n)}`), ...GONE];
  const spec = fc.record({
    binder: fc.constantFrom(CHORES, CHORES, ERRANDS),
    kind: fc.constantFrom<ItemProposalKind>("create", "update", "delete"),
    status: fc.constantFrom(...STATUSES),
    on: fc.nat(),
    fields: fieldsArb,
  });
  return fc.tuple(itemsArb, fc.array(spec, { maxLength: 16 }), viewArb).chain(([items, specs, view]) => {
    const order = [...specs.keys()];
    return fc.tuple(fc.shuffledSubarray(order, { minLength: order.length }), fc.shuffledSubarray(order, { minLength: order.length })).map(([ids, listed]) => {
      // The ids are drawn apart from the times, so the oldest isn't the smallest id.
      const proposals = specs.map((one, at) =>
        proposal({
          id: proposalId(ids[at] ?? at),
          at: minute(at),
          binder: one.binder,
          kind: one.kind,
          handle: handles[one.on % handles.length] ?? null,
          status: one.status,
          fields: one.kind === "delete" ? {} : one.fields,
        }),
      );
      return { items, proposals: listed.map((at) => proposals[at]).filter((p) => p !== undefined), view };
    });
  });
});

/** The rows a view shows, a tree's children included. */
const shownIn = (rows: readonly Row[], view: LenientView): Row[] => {
  const flat = (row: TreeRow): Row[] => [row, ...row.children.flatMap(flat)];
  if (view.kind === "board") return boardColumns(rows, view, OWN).flatMap((column) => column.rows);
  if (view.kind === "tree") return treeRows(rows, view, OWN).flatMap(flat);
  return listGroups(rows, view, OWN).flatMap((group) => group.rows);
};

/** Which row a proposal belongs on: its create's, or its handle's (an item's or a missing one's). */
const homeOf = (p: ItemProposalRead): string => (p.kind === "create" ? `create:${p.id}` : `handle:${String(p.handle)}`);
const rowHome = (row: Row): string => (isPending(row) ? `create:${row.pending.id}` : isItemRow(row) ? `handle:${String(row.item.handle)}` : `handle:${row.missing}`);

const ownOpen = ({ proposals }: Scenario): ItemProposalRead[] => proposals.filter((p) => p.binder === CHORES && OPEN.has(p.status));
const byAge = (a: ItemProposalRead, b: ItemProposalRead): number => Date.parse(a.at) - Date.parse(b.at);

describe("withProposals", () => {
  test("every open proposal of the binder shows exactly once in every view, filtered out or its item gone, with a line of its own; decided ones and other binders' never; every item once", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { items, view } = scenario;
        const rows = withProposals(items, scenario.proposals, CHORES, itemsOfScenario(items));
        const itemRows = rows.flatMap((row) => itemRowOf(row) ?? []);
        const pendingRows = rows.flatMap((row) => pendingOf(row) ?? []);

        expect(itemRows.map((row) => row.item), "each item once, as read").toEqual(items);

        const open = ownOpen(scenario);
        const changes = open.filter((p) => p.kind !== "create");
        const creates = open.filter((p) => p.kind === "create");

        for (const row of itemRows) {
          const on = changes.filter((p) => p.handle === row.item.handle).sort(byAge);
          expect(row.proposal?.id, `${String(row.item.handle)} is marked with the oldest`).toBe(on[0]?.id);
          expect(struck(row), `${String(row.item.handle)} is struck exactly when its mark is a delete`).toBe(on[0]?.kind === "delete");
        }
        for (const p of creates) expect(pendingRows.find((row) => row.pending.id === p.id)?.fields, `${p.id} carries its fields`).toEqual(p.fields);

        const said = `view ${JSON.stringify(view)}`;
        const shown = shownIn(rows, view);
        for (const p of open) {
          const on = shown.filter((row) => rowProposalIds(row).includes(p.id));
          expect(on.map(rowHome), `${p.kind} ${p.id} shows on exactly its own row (${said})`).toEqual([homeOf(p)]);
        }
        const others = new Set(scenario.proposals.filter((p) => !open.includes(p)).map(({ id }) => id));
        for (const row of shown) {
          expect(rowProposalIds(row).filter((id) => others.has(id)), `${rowHome(row)} holds no decided or other binder's proposal`).toEqual([]);
          const lines = proposalLines(row).map(({ id }) => id);
          expect(lines, `${rowHome(row)} has a line for each proposal on it, oldest first`).toEqual(open.filter((p) => homeOf(p) === rowHome(row)).sort(byAge).map(({ id }) => id));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("revealing a proposal", () => {
  test("every open proposal of the binder is on exactly one row's reveal attribute, its item's or its own; no other proposal is", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const rows = withProposals(scenario.items, scenario.proposals, CHORES, itemsOfScenario(scenario.items));
        const holding = (id: string): Row[] => rows.filter((row) => (proposalProps(row)[PROPOSAL_ATTRIBUTE] ?? "").split(" ").includes(id));
        const open = ownOpen(scenario);
        for (const p of open) {
          const found = holding(p.id);
          expect(found, `${p.kind} ${p.id} is found on one row`).toHaveLength(1);
          const [row] = found;
          if (row === undefined) continue;
          if (p.kind === "create") expect(pendingOf(row)?.pending.id, `${p.id} is found on its own row`).toBe(p.id);
          else expect(rowHome(row), `${p.id} is found on its item's row, or its missing item's`).toBe(`handle:${String(p.handle)}`);
        }
        for (const p of scenario.proposals.filter((one) => !open.includes(one))) expect(holding(p.id), `${p.id} (${p.binder}, ${p.status}) is on no row`).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

// ---- A proposed create beside an item holding the same fields ----

const LINKS = { parent: CHORES, area: PLACES, shed: SHEDS } as const;
type LinkName = keyof typeof LINKS;
const LINKED: Properties = {
  stage: { type: "select", options: [...STAGES], required: false },
  effort: { type: "number", required: false },
  parent: { type: "link", to: CHORES, required: false },
  area: { type: "link", to: PLACES, required: false },
  shed: { type: "link", to: SHEDS, required: false },
};

const PLACE_ITEMS = [1, 2, 3, 4].map((n) => placeItem(n));
// SH-1 is a copied file: it carries PL-2's id.
const SHED_ITEMS = [{ ...shedItem(1), id: idIn("7b00", 2) }, shedItem(2)];
const MISSING_ID = idIn("7f00", 0xdead);
/** The item holding what the create proposes; its handle sorts after every other item's, as a create's row does. */
const TWIN = 999;

type LinkScenario = { items: ItemSummary[]; fields: Record<string, unknown>; twin: ItemSummary; view: LenientView };

const LINK_CREATE = proposalId(0xd001);

const itemsOfScenario = (items: readonly ItemSummary[]): ItemsOf => (to) => (to === CHORES ? items : to === PLACES ? PLACE_ITEMS : to === SHEDS ? SHED_ITEMS : []);

/** The link to `id` as an item of binder `to` holds it: named by `to`'s own items only. */
const heldLink = (items: readonly ItemSummary[], to: string, id: string): LinkValue => ({ id, handle: itemsOfScenario(items)(to).find((one) => one.id === id)?.handle ?? null });

const linkScenarioArb: fc.Arbitrary<LinkScenario> = fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 8 }).chain((numbers) => {
  const own = numbers.map((n) => chore(n));
  // Every link may name any binder's item: one only its own binder holds must not lend its handle.
  const candidates = [...own, ...PLACE_ITEMS, ...SHED_ITEMS].map(({ id, handle }) => ({ id: id ?? MISSING_ID, handle }));
  const targets = fc.constantFrom(...candidates, { id: MISSING_ID, handle: null });
  const values = fc.record(
    { stage: fc.constantFrom(...STAGES), effort: fc.integer({ min: 1, max: 4 }), parent: targets, area: targets, shed: targets },
    { requiredKeys: [] },
  );
  const viewArb = fc.record({
    kind: fc.constantFrom("list", "board"),
    group: fc.constantFrom(undefined, "parent", "area", "shed", "stage"),
    sort: fc.shuffledSubarray(["parent", "area", "shed", "effort"]),
    filterOn: fc.constantFrom<LinkName | undefined>(undefined, "parent", "area", "shed"),
    filterOwn: fc.boolean(),
    filterTo: fc.constantFrom(...candidates),
    filterBy: fc.constantFrom("handle", "id"),
  });
  return fc.tuple(fc.array(values, { minLength: own.length, maxLength: own.length }), values, viewArb).map(([held, proposed, v]): LinkScenario => {
    const asHeld = (values: typeof proposed): Record<string, unknown> =>
      Object.fromEntries(Object.entries(values).map(([name, value]): [string, unknown] => (typeof value === "object" ? [name, heldLink(own, LINKS[name as LinkName], value.id)] : [name, value])));
    const items = own.map((one, at) => ({ ...one, properties: asHeld(held[at] ?? {}) }));
    // As a proposal holds them: links as bare ids.
    const fields: Record<string, unknown> = { title: "Put up the bean poles", ...Object.fromEntries(Object.entries(proposed).map(([name, value]) => [name, typeof value === "object" ? value.id : value])) };
    const twin = { ...chore(TWIN), title: "Put up the bean poles", properties: asHeld(proposed) };

    let filter: Record<string, string> | undefined;
    if (v.filterOn !== undefined) {
      const target = (v.filterOwn ? proposed[v.filterOn] : undefined) ?? v.filterTo;
      filter = { [v.filterOn]: v.filterBy === "handle" && target.handle !== null ? target.handle : target.id };
    }
    const base = { name: "Generated", sort: v.sort, ...(filter === undefined ? {} : { filter }) };
    const view: LenientView = v.kind === "board" ? { ...base, kind: "board", column: "stage" } : { ...base, kind: "list", ...(v.group === undefined ? {} : { group: v.group }) };
    return { items, fields, twin, view };
  });
});

const isTwin = (row: Row): boolean => itemRowOf(row)?.item.handle === `CH-${String(TWIN)}`;
const isCreate = (row: Row): boolean => pendingOf(row)?.pending.id === LINK_CREATE;
/** Which list holds the first row `find` matches, and where in it. */
const where = (lists: readonly (readonly Row[])[], find: (row: Row) => boolean): [number, number] => {
  for (const [at, list] of lists.entries()) {
    const index = list.findIndex(find);
    if (index >= 0) return [at, index];
  }
  return [-1, -1];
};

describe("a proposed create in a binder's views", () => {
  test("is filtered (a link by handle or id), grouped, sorted and placed on a board exactly as an item holding the same fields, each link named only by its own binder's items", () => {
    fc.assert(
      fc.property(linkScenarioArb, ({ items, fields, twin, view }) => {
        const create = proposal({ id: LINK_CREATE, at: minute(0), binder: CHORES, kind: "create", handle: null, status: "pending", fields });
        const rows = [...withProposals(items, [create], CHORES, itemsOfScenario(items)), { item: twin }];
        const said = `view ${JSON.stringify(view)}, fields ${JSON.stringify(fields)}`;

        const twinShown = visibleItems(rows, view, LINKED).some(isTwin);
        expect(visibleItems(rows, view, LINKED).some(isCreate), `passes the filter exactly when the item does (${said})`).toBe(twinShown);

        const order = sorted(rows, view, LINKED);
        expect(order.findIndex(isCreate), `sorts right after the item (${said})`).toBe(order.findIndex(isTwin) + 1);

        const lists = view.kind === "board" ? boardColumns(rows, view, LINKED) : listGroups(rows, view, LINKED);
        const [twinAt, twinIndex] = where(lists.map((list) => list.rows), isTwin);
        const [createAt, createIndex] = where(lists.map((list) => list.rows), isCreate);
        if (twinShown) {
          expect(lists[createAt]?.key, `in the item's group or column (${said})`).toBe(lists[twinAt]?.key);
          expect(createIndex, `right after the item there (${said})`).toBe(twinIndex + 1);
        } else if (view.kind === "board") {
          const stage = fields["stage"];
          expect(lists[createAt]?.key, `still on the board, in its stage's column (${said})`).toBe(typeof stage === "string" ? `value:${stage}` : "none");
        } else {
          expect(lists[createAt]?.key, `outside the filter, as the item is filtered out (${said})`).toBe("outside");
        }
      }),
      { numRuns: 300 },
    );
  });
});
