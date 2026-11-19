// What a binder's list and tree views show: every visible item once (filtered ones never), in groups that follow the
// options with the no-value group last, in the view's sort with text as a person reads it, nested under its parent
// with cycles cut. The expected orders come from the rules below, written out by hand, not from the code.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import type { ItemSummary, LenientProperty, LenientView } from "@wombat/shared/items";

import { listGroups, treeRows, type TreeRow } from "./view-model.ts";

type Properties = Record<string, LenientProperty>;

// ---- Invented items ----

const idOf = (n: number): string => `0196f3c2-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const handleOf = (n: number): string => `BL-${String(n)}`;

const item = (n: number, properties: Record<string, unknown> = {}): ItemSummary => ({
  id: idOf(n),
  handle: handleOf(n),
  aliases: [],
  title: `Invented item ${String(n)}`,
  properties,
  path: `backlog/${handleOf(n)}-invented.md`,
  version: "0".repeat(64),
  problems: [],
});

const numberOf = (one: ItemSummary): number => Number(one.handle?.slice("BL-".length));
const handles = (items: readonly ItemSummary[]): (string | null)[] => items.map((one) => one.handle);

// ---- The rules, by hand ----

/** Text values in the order a person reads them: case aside (code units break a tie), numbers by value. */
const TEXT_IN_READING_ORDER = ["Apple", "apple", "b9", "B10", "b10", "item 2", "Item 10", "zebra"];
const NUMBERS = [1, 2, 3, 10];
const OPTIONS = ["meadow", "atlas", "harbor"];

/** A value's place in its property's order; undefined when it has none (missing, empty, wrong type, unknown option). */
const rankOf = (property: LenientProperty | undefined, value: unknown): number | undefined => {
  switch (property?.type) {
    case "select":
      return typeof value === "string" && property.options.includes(value) ? property.options.indexOf(value) : undefined;
    case "number":
      return typeof value === "number" ? value : undefined;
    case "text":
      return typeof value === "string" && value !== "" ? TEXT_IN_READING_ORDER.indexOf(value) : undefined;
    default:
      return undefined;
  }
};

/** By each sort property in turn, a value before none, then by handle number. */
const expectedOrder = (sortBy: readonly string[], properties: Properties) => (a: ItemSummary, b: ItemSummary) => {
  for (const name of sortBy) {
    const [x, y] = [rankOf(properties[name], a.properties[name]), rankOf(properties[name], b.properties[name])];
    if (x === undefined && y === undefined) continue;
    if (x === undefined || y === undefined) return x === undefined ? 1 : -1;
    if (x !== y) return x - y;
  }
  return numberOf(a) - numberOf(b);
};

/** A filter matches a link by its target's handle or id, anything else as text on both sides ("3" and 3). */
const matches = (value: unknown, want: string | number | boolean): boolean => {
  if (typeof value === "object" && value !== null) {
    const { id, handle } = value as { id: string; handle: string | null };
    return handle === String(want) || id === String(want);
  }
  return (typeof value === "string" || typeof value === "number" || typeof value === "boolean") && String(value) === String(want);
};

const expectedVisible = (items: readonly ItemSummary[], view: LenientView) =>
  items.filter((one) => Object.entries(view.filter ?? {}).every(([name, want]) => matches(one.properties[name], want)));

// ---- Generated binders ----

const propertiesArb = fc.shuffledSubarray(OPTIONS, { minLength: 1 }).map(
  (options): Properties => ({
    project: { type: "select", options, required: false },
    note: { type: "text", required: false },
    size: { type: "number", required: false },
    parent: { type: "link", to: "backlog", required: false },
  }),
);

/** A value of each property, or none; wrong types, unknown options and empty text included. */
const valuesArb = fc.record(
  {
    project: fc.constantFrom(...OPTIONS, "unlisted", ""),
    note: fc.constantFrom(...TEXT_IN_READING_ORDER, "", 7),
    size: fc.constantFrom(...NUMBERS, "3", "lots"),
    parent: fc.oneof(fc.nat(), fc.constant("missing" as const)),
  },
  { requiredKeys: [] },
);

const binderArb = fc.tuple(propertiesArb, fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { maxLength: 25 })).chain(([properties, numbers]) =>
  fc.array(valuesArb, { minLength: numbers.length, maxLength: numbers.length }).map((values) => ({
    properties,
    numbers,
    items: values.map(({ parent, ...rest }, index) => {
      const n = numbers[index] ?? 0;
      const target = parent === undefined ? undefined : parent === "missing" ? undefined : numbers[parent % numbers.length];
      const link =
        parent === undefined ? {} : { parent: target === undefined ? { id: idOf(1000 + n), handle: null } : { id: idOf(target), handle: handleOf(target) } };
      return item(n, { ...rest, ...link });
    }),
  })),
);

const filterArb = (numbers: readonly number[]) =>
  fc.record(
    {
      project: fc.constantFrom(...OPTIONS, "unlisted"),
      size: fc.constantFrom(3, "3", 10),
      note: fc.constantFrom(...TEXT_IN_READING_ORDER),
      parent: fc.constantFrom(...numbers.flatMap((n) => [handleOf(n), idOf(n)]), "BL-999"),
    },
    { requiredKeys: [] },
  );

const viewArb = (numbers: readonly number[]) =>
  fc.record(
    {
      name: fc.constant("Generated"),
      kind: fc.constant("list" as const),
      filter: filterArb(numbers),
      sort: fc.shuffledSubarray(["project", "note", "size"]),
      group: fc.constantFrom("project", "note", "size"),
    },
    { requiredKeys: ["name", "kind"] },
  ) as fc.Arbitrary<Extract<LenientView, { kind: "list" }>>;

describe("listGroups", () => {
  test("every visible item once, filtered ones never; groups in option or value order, no value last; each group in the sort's order", () => {
    fc.assert(
      fc.property(
        binderArb.chain((binder) => fc.tuple(fc.constant(binder), viewArb(binder.numbers))),
        ([{ items, properties }, view]) => {
          const order = expectedOrder(view.sort ?? [], properties);
          const visible = expectedVisible(items, view).toSorted(order);
          const got = listGroups(items, view, properties).map((group) => ({
            group: group.kind === "value" ? group.value : group.kind,
            rows: handles(group.rows.map((row) => row.item)),
          }));

          const name = view.group;
          if (name === undefined) {
            expect(got).toEqual([{ group: "all", rows: handles(visible) }]);
            return;
          }
          const property = properties[name];
          const ranked = visible.filter((one) => rankOf(property, one.properties[name]) !== undefined);
          const values =
            property?.type === "select"
              ? property.options
              : [...new Set(ranked.map((one) => one.properties[name]))].toSorted((a, b) => (rankOf(property, a) ?? 0) - (rankOf(property, b) ?? 0));
          const none = visible.filter((one) => rankOf(property, one.properties[name]) === undefined);
          expect(got).toEqual([
            ...values.map((value) => ({ group: value, rows: handles(ranked.filter((one) => one.properties[name] === value)) })),
            ...(none.length > 0 ? [{ group: "none", rows: handles(none) }] : []),
          ]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("treeRows", () => {
  /** Each row's item with the item it sits under (null at the top). */
  const placed = (rows: readonly TreeRow[], parent: ItemSummary | null = null): { item: ItemSummary; parent: ItemSummary | null }[] =>
    rows.flatMap((row) => [{ item: row.item, parent }, ...placed(row.children, row.item)]);

  // Mostly unfiltered, so most runs hold cycles.
  const treeViewArb = (numbers: readonly number[]) =>
    fc
      .tuple(fc.oneof({ weight: 3, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: filterArb(numbers) }), fc.shuffledSubarray(["project", "note", "size"]))
      .map(([filter, sort]): LenientView => ({ name: "Tree", kind: "tree", parent: "parent", sort, ...(filter === undefined ? {} : { filter }) }));

  test("every visible item once, under its parent, or at the top when the parent is missing, filtered out or on a cut cycle", () => {
    fc.assert(
      fc.property(
        binderArb.chain((binder) => fc.tuple(fc.constant(binder), treeViewArb(binder.numbers))),
        ([{ items, properties }, view]) => {
          const visible = expectedVisible(items, view);
          const rows = placed(treeRows(items, view, properties));
          expect(handles(rows.map((row) => row.item)).toSorted()).toEqual(handles(visible).toSorted());

          const byId = new Map(visible.map((one) => [one.id, one]));
          /** The visible item a visible item links to as its parent; never itself. */
          const parentOf = (one: ItemSummary): ItemSummary | undefined => {
            const target = byId.get((one.properties["parent"] as { id?: string } | undefined)?.id ?? null);
            return target === one ? undefined : target;
          };
          /** The items on the cycle a walk up from `one` ends in, or undefined when the walk reaches the top. */
          const cycleFrom = (one: ItemSummary): ItemSummary[] | undefined => {
            const walked: ItemSummary[] = [];
            for (let at: ItemSummary | undefined = one; at !== undefined; at = parentOf(at)) {
              const seen = walked.indexOf(at);
              if (seen >= 0) return walked.slice(seen);
              walked.push(at);
            }
            return undefined;
          };

          const topsPerCycle = new Map<string, number>();
          for (const { item: one, parent } of rows) {
            const linked = parentOf(one);
            const cycle = cycleFrom(one);
            if (parent !== null) expect(parent, `${String(one.handle)} sits under its parent`).toBe(linked);
            else if (linked !== undefined) {
              expect(cycle?.includes(one), `${String(one.handle)} is at the top with its parent shown, so it is on a cycle`).toBe(true);
              const key = handles(cycle ?? []).toSorted().join(" ");
              topsPerCycle.set(key, (topsPerCycle.get(key) ?? 0) + 1);
            }
          }
          const cycles = new Set(visible.flatMap((one) => (cycleFrom(one) === undefined ? [] : [handles(cycleFrom(one) ?? []).toSorted().join(" ")])));
          expect(Object.fromEntries(topsPerCycle), "each cycle is cut once").toEqual(Object.fromEntries([...cycles].map((key) => [key, 1])));
        },
      ),
      { numRuns: 300 },
    );
  });
});
