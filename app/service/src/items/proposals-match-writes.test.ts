// Lasting check (silent failure): proposals refuse what writes refuse. Each change runs twice on twin
// structures that differ only in their access level: through the edit tools (create, update, remove) on the
// `edit` twin, and through propose_* on the `propose` twin. A proposal must be refused exactly when the direct
// write is, with the same code and problems on the same fields; otherwise a proposal is stored that can only
// conflict at approval. Messages aren't compared: proposals refuse in the writer's words (D6).
import { describe, expect, test } from "vitest";

import { AccessError, type Access } from "./access.ts";
import { AGENT, openAccessRoot } from "../../test/access-fixtures.ts";

/** The twins of each kind: `edit` is written directly, `propose` takes proposals; ids, prefixes and folders differ. */
const TWINS = {
  named: { edit: { id: "tasks", prefix: "TSK" }, propose: { id: "ideas", prefix: "IDA" } },
  free: { edit: { id: "notes", prefix: "NOTE" }, propose: { id: "drafts", prefix: "DRF" } },
  broken: { edit: { id: "chores", prefix: "CHR" }, propose: { id: "wishes", prefix: "WSH" } },
} as const;
type Level = "edit" | "propose";

const settings = (id: string, prefix: string, access: Level, linkTo = id) => `version: 1
id: ${id}
name: ${id}
prefix: ${prefix}
access: ${access}
properties:
  status: { type: select, options: [open, done], required: true }
  note: { type: text }
  parent: { type: link, to: ${linkTo} }
`;

const freeSettings = (id: string, prefix: string, access: Level) =>
  `version: 1\nid: ${id}\nname: ${id}\nprefix: ${prefix}\naccess: ${access}\nnaming: free\ninclude: ["**/*.md"]\nproperties:\n  note: { type: text }\n`;

/** The handle-named twin's items, by handle number: one sound, and one per way an item can block a change. */
const ITEMS: Record<number, { file: string; frontmatter: string; text: string }> = {
  1: { file: "sound", frontmatter: "status: open\n", text: "# Ship the search page\n\nInvented.\n" },
  // Identity problems (D15): an undeclared key, a handle two files share, no title.
  2: { file: "undeclared", frontmatter: "status: open\nstray: left by hand\n", text: "# An undeclared key\n\nInvented.\n" },
  3: { file: "shared-a", frontmatter: "status: open\n", text: "# One of two with this handle\n\nInvented.\n" },
  5: { file: "untitled", frontmatter: "status: open\n", text: "No heading here.\n" },
  // A value another key aliases: changing it can't be done in place.
  6: { file: "anchored", frontmatter: "status: open\nnote: &shared seen twice\nparent: *shared\n", text: "# An anchored note\n\nInvented.\n" },
};

const idOf = (twin: number, item: number) => `0196f3c2-9f00-7000-8000-0000000${String(twin)}${String(item).padStart(4, "0")}`;

const files = (): Record<string, string> => {
  const root: Record<string, string> = {};
  for (const [twin, level] of [[1, "edit"], [2, "propose"]] as const) {
    const { id, prefix } = TWINS.named[level];
    root[`${id}/_structure.yaml`] = settings(id, prefix, level);
    for (const [n, item] of Object.entries(ITEMS)) {
      root[`${id}/${prefix}-${n}-${item.file}.md`] = `---\nid: ${idOf(twin, Number(n))}\nhandle: ${prefix}-${n}\n${item.frontmatter}---\n${item.text}`;
    }
    // The second file with handle -3.
    root[`${id}/${prefix}-3-shared-b.md`] = `---\nid: ${idOf(twin, 4)}\nhandle: ${prefix}-3\nstatus: done\n---\n# The other with this handle\n\nInvented.\n`;

    const free = TWINS.free[level];
    root[`${free.id}/_structure.yaml`] = freeSettings(free.id, free.prefix, level);
    root[`${free.id}/existing.md`] = `---\nid: ${idOf(twin, 9)}\nhandle: ${free.prefix}-1\n---\n# Existing\n\nInvented.\n`;

    // A link to a structure that doesn't exist: a problem of the structure's settings, refusing every change.
    const broken = TWINS.broken[level];
    root[`${broken.id}/_structure.yaml`] = settings(broken.id, broken.prefix, level, "no-such-structure");
  }
  return root;
};

const NEW = { title: "A new task", body: "\nInvented.\n" };

/** What each twin is given: a structure kind and a create input, or an item number and update fields, or a delete. */
type Change =
  | { kind: "create"; twin: keyof typeof TWINS; input: Record<string, unknown> }
  | { kind: "update"; item: number; fields: Record<string, unknown>; stale?: true }
  | { kind: "delete"; item: number; stale?: true };

type Row = { what: string; expect: "accepted" | "refused"; change: Change };

const ROWS: Row[] = [
  // create
  { what: "create (control)", expect: "accepted", change: { kind: "create", twin: "named", input: { ...NEW, properties: { status: "open" } } } },
  { what: "free-named create (control)", expect: "accepted", change: { kind: "create", twin: "free", input: { ...NEW, file: "new-note.md" } } },
  // update
  { what: "update (control)", expect: "accepted", change: { kind: "update", item: 1, fields: { note: "Seen again", title: "Ship the search page soon" } } },
  { what: "update clearing an optional property (control)", expect: "accepted", change: { kind: "update", item: 1, fields: { note: null } } },
  { what: "update sent with an old version", expect: "refused", change: { kind: "update", item: 1, fields: { note: "x" }, stale: true } },
  // delete
  { what: "delete of an item without a title (control)", expect: "accepted", change: { kind: "delete", item: 5 } },
];

/** What the agent got: accepted, or the refusal's code and the fields its problems name (messages left out). */
const outcome = async (call: () => Promise<unknown>) => {
  try {
    await call();
    return { accepted: true } as const;
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return { code: error.code, fields: error.problems.map((problem) => problem.field ?? null).sort() };
  }
};

/** The change as the given twin's family makes it. */
const run = async (access: Access, level: Level, change: Change) => {
  const { prefix } = TWINS.named[level];
  if (change.kind === "create") {
    const { id } = TWINS[change.twin][level];
    const input = change.input as Parameters<Access["create"]>[2];
    return outcome(() => (level === "edit" ? access.create(AGENT, id, input) : access.proposeCreate(AGENT, id, input, "Asked for in review.")));
  }
  const handle = `${prefix}-${String(change.item)}`;
  // A shared handle can't be read to a version (the agent sees one of the files); the sound item's version stands in.
  const read = change.item === 3 ? `${prefix}-1` : handle;
  const version = change.stale === true ? "0".repeat(64) : (await access.get(read)).version;
  if (change.kind === "update") {
    return outcome(() =>
      level === "edit" ? access.update(AGENT, handle, change.fields, version) : access.proposeUpdate(AGENT, handle, change.fields, version, "Asked for in review."),
    );
  }
  return outcome(() => (level === "edit" ? access.remove(AGENT, handle, version) : access.proposeDelete(AGENT, handle, version, "Asked for in review.")));
};

describe("proposals refuse what writes refuse", () => {
  test.each(ROWS)("$what: $expect the same way by both families", async ({ what, expect: expected, change }) => {
    const { access } = openAccessRoot(files());

    const edit = await run(access, "edit", change);
    const propose = await run(access, "propose", change);

    expect("accepted" in edit ? "accepted" : "refused", `${what}: the direct write (${JSON.stringify(edit)})`).toBe(expected);
    expect(propose, `${what}: the proposal answers like the direct write`).toEqual(edit);
  });
});
