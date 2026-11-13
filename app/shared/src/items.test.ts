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

const withProperties = (properties: Record<string, unknown>) => ({ ...full, properties: { ...full.properties, ...properties } });
const withView = (view: Record<string, unknown>) => ({ ...full, views: [view] });

const free = (include: unknown) => ({ ...full, naming: "free", include });

type Path = (string | number)[];
// [case, settings, null when it parses; or where the refusal is and a phrase its message must have]
const cases: [string, object, null | [Path, string]][] = [
  ["the full example", full, null],
  ["an unknown key", { ...full, colour: "red" }, [["colour"], "colour"]],
  ["instructions on an edit structure", { ...full, access: "edit", instructions: "full" }, [["instructions"], "without your approval"]],
  ["locked naming an unknown field", { ...full, locked: ["title", "status"] }, [["locked", 1], "status"]],
  ["an include glob that leaves the folder", free(["{guides,..}/*.md"]), [["include", 0], "include"]],
  ["a property named id", withProperties({ id: { type: "text" } }), [["properties", "id"], '"id"']],
  ["a board column that isn't a select", withView({ name: "B", kind: "board", column: "note" }), [["views", 0, "column"], "column"]],
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
