// A structure's settings: what the service enforces on agents, so a contradiction must be refused, not guessed at.
import { expect, test } from "vitest";

import type { z } from "zod";

import { Item, Proposal, StructureSettings, StructureSummary } from "./items.ts";

/** Every property type and view kind, in a propose structure with handle naming. */
const full = {
  version: 1,
  id: "bugs",
  name: "Bugs",
  prefix: "BUG",
  access: "propose",
  naming: "handle",
  instructions: "full",
  locked: ["title", "repo"],
  properties: {
    repo: { type: "select", options: ["site-web", "api"], required: false },
    noted: { type: "date" },
    order: { type: "number" },
    note: { type: "text", required: true },
    parent: { type: "link", to: "bugs" },
    blocks: { type: "link", to: "backlog" },
  },
  views: [
    { name: "Open", kind: "list", filter: { repo: "api" }, group: "repo", sort: ["noted", "order"] },
    { name: "Board", kind: "board", column: "repo" },
    { name: "Tree", kind: "tree", parent: "parent" },
  ],
};

const without = (...keys: string[]) => Object.fromEntries(Object.entries(full).filter(([key]) => !keys.includes(key)));
/** The full example without `locked` and `instructions`, which hidden and read structures can't have. */
const unlocked = without("locked", "instructions");
const withProperties = (properties: Record<string, unknown>) => ({ ...full, properties: { ...full.properties, ...properties } });
const withView = (view: Record<string, unknown>) => ({ ...full, views: [view] });

const free = (include: unknown) => ({ ...full, naming: "free", include });

type Path = (string | number)[];
// [case, settings, null when it parses; or where the refusal is and a phrase its message must have]
const cases: [string, object, null | [Path, string]][] = [
  ["the full example", full, null],
  ["edit access", { ...full, access: "edit", instructions: "off" }, null],
  ["read access", { ...unlocked, access: "read", instructions: "index" }, null],
  ["hidden access", { ...unlocked, access: "hidden" }, null],
  ["free naming with include", free(["*.md", "guides/*.md"]), null],
  ["only the required keys", { version: 1, id: "docs", name: "Docs", prefix: "DOC", access: "read" }, null],
  ["an unknown key", { ...full, colour: "red" }, [["colour"], "colour"]],
  ["a missing required key", without("prefix"), [["prefix"], "prefix is required, like prefix: BUG"]],
  ["locked that isn't a list", { ...full, locked: "title" }, [["locked"], "locked takes a list, like locked: [title]"]],
  ["instructions on a hidden structure", { ...unlocked, access: "hidden", instructions: "index" }, [["instructions"], "instructions"]],
  ["instructions on an edit structure", { ...full, access: "edit", instructions: "full" }, [["instructions"], "without your approval"]],
  ["locked on a hidden structure", { ...full, access: "hidden", instructions: "off" }, [["locked"], "locked"]],
  ["locked on a read structure", { ...full, access: "read" }, [["locked"], "locked"]],
  ["locked naming an unknown field", { ...full, locked: ["title", "status"] }, [["locked", 1], "status"]],
  [
    "locked inside a property",
    withProperties({ repo: { type: "select", options: ["api"], locked: true } }),
    [["properties", "repo", "locked"], "locked: lock a property in the structure's top-level list, like locked: [repo]"],
  ],
  ["include without naming: free", { ...full, include: ["*.md"] }, [["include"], "include"]],
  ["naming: free without include", { ...full, naming: "free" }, [["naming"], "include"]],
  ...["/srv/notes/*.md", "../bugs/*.md", "guides\\*.md", "{guides,..}/*.md"].map(
    (glob): [string, object, [Path, string]] => [`an include glob ${glob}`, free([glob]), [["include", 0], "include"]],
  ),
  ...["id", "handle", "aliases", "title", "body"].map(
    (name): [string, object, [Path, string]] => [
      `a property named ${name}`,
      withProperties({ [name]: { type: "text" } }),
      [["properties", name], `"${name}"`],
    ],
  ),
  ["a property with no name", withProperties({ "": { type: "text" } }), [["properties"], "a property needs a name"]],
  ["a select without options", withProperties({ size: { type: "select" } }), [["properties", "size", "options"], "options"]],
  ["a select with no options", withProperties({ size: { type: "select", options: [] } }), [["properties", "size", "options"], "options"]],
  [
    "a select with an option twice",
    withProperties({ size: { type: "select", options: ["s", "m", "s"] } }),
    [["properties", "size", "options"], '"s"'],
  ],
  ["a board column that isn't a select", withView({ name: "B", kind: "board", column: "note" }), [["views", 0, "column"], "column"]],
  ["a tree parent that isn't a link", withView({ name: "T", kind: "tree", parent: "order" }), [["views", 0, "parent"], "parent"]],
  ["a tree parent linking another structure", withView({ name: "T", kind: "tree", parent: "blocks" }), [["views", 0, "parent"], "parent"]],
  ["a list filtering on an unknown property", withView({ name: "L", kind: "list", filter: { status: "open" } }), [["views", 0, "filter"], "status"]],
  ["a list grouped by an unknown property", withView({ name: "L", kind: "list", group: "status" }), [["views", 0, "group"], "status"]],
  ["a list sorted by an unknown property", withView({ name: "L", kind: "list", sort: ["noted", "status"] }), [["views", 0, "sort"], "status"]],
  ["a board on an unknown property", withView({ name: "B", kind: "board", column: "status" }), [["views", 0, "column"], "status"]],
  ["a tree on an unknown property", withView({ name: "T", kind: "tree", parent: "status" }), [["views", 0, "parent"], "status"]],
];

/** Where an issue is: its path, and for an unknown key the key itself. */
const location = (issue: z.core.$ZodIssue): Path => [
  ...(issue.path as Path),
  ...(issue.code === "unrecognized_keys" ? issue.keys : []),
];

test.each(cases)("settings: %s", (_case, settings, refusal) => {
  const result = StructureSettings.safeParse(settings);
  if (refusal === null) {
    expect(result.error?.issues).toBeUndefined();
    return;
  }
  const [path, phrase] = refusal;
  const issues = (result.error?.issues ?? []).map((issue) => ({ at: location(issue), message: issue.message }));
  expect(issues.some(({ at, message }) => path.every((key, index) => at[index] === key) && message.includes(phrase)), JSON.stringify(issues)).toBe(true);
});

// The app reads these from the service; a newer service may add fields, view kinds and property types, and an
// older app must still show the rest instead of failing the whole response.
test("API shapes stay lenient: unknown fields stripped, unknown view kinds dropped, unknown property types kept", () => {
  const listing = { path: "bugs", itemCount: 2, invalidCount: 1, problems: [{ field: "repo", message: "repo: not an option" }] };
  const structure = {
    id: "bugs",
    name: "Bugs",
    prefix: "BUG",
    access: "propose",
    naming: "handle",
    instructions: "off",
    properties: { repo: full.properties.repo, rank: { type: "rating", max: 5 } },
    views: [...full.views, { name: "Calendar", kind: "calendar", date: "noted" }],
    ...listing,
  };
  expect(StructureSummary.parse({ ...structure, colour: "red" })).toEqual({
    ...structure,
    properties: { repo: full.properties.repo, rank: { type: "unknown", original: "rating", max: 5 } },
    views: full.views,
  });
  expect(StructureSummary.parse({ id: null, ...listing, colour: "red" })).toEqual({ id: null, ...listing });

  const item = {
    id: "0196f3c2-1a00-7000-8000-000000000001",
    handle: "BUG-1",
    aliases: [],
    title: "Login times out",
    properties: { repo: "api", blocks: { id: "0196f3c2-2b00-7000-8000-000000000001", handle: "BL-1" } },
    path: "bugs/BUG-1-login-times-out.md",
    version: "9f2c",
    problems: [],
    body: "\nSteps: sign in.\n",
  };
  expect(Item.parse({ ...item, colour: "red" })).toEqual(item);

  const proposal = {
    id: "prp_1",
    structure: "bugs",
    kind: "update",
    handle: "BUG-1",
    fields: { repo: "site-web" },
    file: null,
    reason: "Seen on the site",
    baseVersion: "9f2c",
    status: "pending",
    agentId: "agt_7f3c2a",
    at: "2026-11-09T10:02:11.120Z",
  };
  expect(Proposal.parse({ ...proposal, colour: "red" })).toEqual(proposal);
});
