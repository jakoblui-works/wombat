// A list's folded groups and a reveal: whatever groups are folded, the row a reveal targets (by its item's id, or by
// the proposal it holds: an item's update or delete, a proposed create, or a change on a missing item) is among the
// list's visible rows once the headers above it (`listAncestorsOf`) are open (`opened`), and the fold set that gives
// settles (opened again, or with nothing to reveal, it is the same set).
import fc from "fast-check";
import { expect, test } from "vitest";

import type { ItemSummary } from "@wombat/shared/items";
import type { ItemProposal } from "@wombat/shared/proposals";

import type { Group, Row } from "../view-model/view-model.ts";
import { opened } from "../tree-keys.ts";
import { listAncestorsOf, listTree } from "./list-tree.ts";

// ---- Invented rows and proposals ----

const idOf = (block: string, n: number): string => `0196f3c2-${block}-7000-8000-${n.toString(16).padStart(12, "0")}`;

const item = (n: number): ItemSummary => ({
  id: idOf("2a00", n),
  handle: `CH-${String(n)}`,
  aliases: [],
  title: `Invented chore ${String(n)}`,
  properties: {},
  path: `chores/CH-${String(n)}.md`,
  version: "0".repeat(64),
  problems: [],
  excerpt: null,
  binder: "chores",
});

const proposal = (n: number, kind: ItemProposal["kind"], handle: string | null): ItemProposal => ({
  target: "item",
  id: idOf("2b00", n),
  status: "pending",
  agentId: idOf("2c00", 1),
  workspace: "ws-apiary0001",
  reason: "Invented reason.",
  version: 1,
  editedByMe: false,
  at: new Date(Date.UTC(2026, 10, 2, 9, n % 60)).toISOString(),
  binder: "chores",
  kind,
  handle,
  file: null,
});

type RowKind = "item" | "itemWithProposals" | "pending" | "missing";

/** Row `n` of kind `kind`; the proposals it holds are numbered from `n * 10`, so no two rows share one. */
const rowOf = (kind: RowKind, n: number, count: number): Row => {
  const handle = `CH-${String(n)}`;
  const changes = Array.from({ length: count }, (_, i) => proposal(n * 10 + i, i % 2 === 0 ? "update" : "delete", handle));
  switch (kind) {
    case "item":
      return { item: item(n) };
    case "itemWithProposals":
      return { item: item(n), proposals: changes, ...(changes[0] === undefined ? {} : { proposal: changes[0] }) };
    case "pending":
      return { pending: proposal(n * 10, "create", null), fields: {}, link: (_to, id) => ({ id, handle: null }) };
    case "missing":
      return { missing: handle, proposals: changes };
  }
};

/** The ids a reveal finds a row by, as the generator made them: its item's, and the open proposals it holds. */
const heldBy = (row: Row): string[] => ("pending" in row ? [row.pending.id] : [...("item" in row && row.item.id !== null ? [row.item.id] : []), ...(row.proposals ?? []).map(({ id }) => id)]);

const rowArb = fc.tuple(fc.constantFrom<RowKind>("item", "itemWithProposals", "pending", "missing"), fc.integer({ min: 1, max: 3 }));

/**
 * Groups as a list shows them: some under a heading (a value or "No ..."), and possibly one without (the rows outside
 * the filter, or the one group of a list without `group`).
 */
const groupsArb = fc
  .array(fc.tuple(fc.constantFrom<Group["kind"]>("value", "none", "outside", "all"), fc.array(rowArb, { maxLength: 4 })), { minLength: 1, maxLength: 5 })
  .map((specs) => {
    let n = 0;
    return specs.map(([kind, rows], g): Group => {
      const built = rows.map(([rowKind, count]) => rowOf(rowKind, ++n, count));
      const key = `${kind}:${String(g)}`;
      switch (kind) {
        case "value":
          return { key, rows: built, kind, value: `value ${String(g)}`, heading: `Value ${String(g)}` };
        case "none":
          return { key, rows: built, kind, heading: "No stage" };
        default:
          return { key, rows: built, kind };
      }
    });
  });

/** Groups, a fold set over their headers' keys (and keys of nothing), and an item or proposal one of their rows holds, if any. */
const caseArb = groupsArb.chain((groups) => {
  const keys = listTree(groups, new Set()).map(({ key }) => key);
  const held = groups.flatMap((group) => group.rows.flatMap((row) => heldBy(row).map((id) => ({ id, row }))));
  return fc.record({
    groups: fc.constant(groups),
    folded: fc.subarray([...keys, "group:gone"]).map((each): ReadonlySet<string> => new Set(each)),
    target: held.length === 0 ? fc.constant(undefined) : fc.option(fc.constantFrom(...held), { nil: undefined }),
  });
});

test("a revealed row shows whatever groups are folded, and the fold set settles", () => {
  fc.assert(
    fc.property(caseArb, ({ groups, folded, target }) => {
      const above = target === undefined ? [] : listAncestorsOf(groups, target.id);
      expect(above, "the row is found").toBeDefined();
      const unfolded = opened(folded, above ?? []);
      expect(opened(unfolded, above ?? []), "asked again, the same set").toBe(unfolded);
      if (target === undefined) {
        expect(unfolded, "nothing to reveal: the same set").toBe(folded);
        return;
      }
      const visible = listTree(groups, unfolded).flatMap(({ node }) => (node.kind === "row" ? [node.row] : []));
      expect(visible, `the row holding ${target.id}`).toContainEqual(target.row);
    }),
    { numRuns: 300 },
  );
});
