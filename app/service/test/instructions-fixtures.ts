// Shared setup for the instructions-file checks: the access fixture's root with its visible structures marked as
// instructions (bugs and backlog in full, both taking proposals; docs as an index), two backlog items that differ
// only in linking to a hidden item or a missing one, and a second hidden structure that asks for instructions
// (which the schema refuses).
import { ACCESS_FILES, HIDDEN, MARKER } from "./access-fixtures.ts";

/** Adds `instructions: <level>` to a structure's settings, right after its access line. */
const marked = (settings: string | undefined, level: "full" | "index") => {
  if (settings === undefined) throw new Error("instructions-fixtures: no such settings file");
  return settings.replace(/^access: (\w+)$/m, (line) => `${line}\ninstructions: ${level}`);
};

/** A hidden structure that asks for instructions: refused by the schema, so it has no valid settings. */
export const ANNEX = { structure: `${MARKER}-annex`, name: "Kestrel annex", handle: "KAX-1", id: "0196f3c2-9a00-7000-8000-000000000031" } as const;

/** An id no item has. */
export const MISSING_ID = "0196f3c2-9f00-7000-8000-000000000099";

const linkTo = (handle: string, id: string, value: string) => `---
id: ${id}
handle: ${handle}
project: wombat
parent: ${value}
---
# A plan linked to elsewhere

Invented, and the same in both files.
`;

export const INSTRUCTIONS_FILES: Record<string, string> = {
  ...ACCESS_FILES,
  "bugs/_structure.yaml": marked(ACCESS_FILES["bugs/_structure.yaml"], "full"),
  // An edit structure can't be marked (agents could change every later agent's instructions unapproved), so
  // the backlog takes proposals here.
  "backlog/_structure.yaml": marked(ACCESS_FILES["backlog/_structure.yaml"]?.replace("access: edit", "access: propose"), "full"),
  "docs/_structure.yaml": marked(ACCESS_FILES["docs/_structure.yaml"], "index"),
  "backlog/BL-3-linked-hidden.md": linkTo("BL-3", "0196f3c2-9c00-7000-8000-000000000003", HIDDEN.ids[0]),
  "backlog/BL-4-linked-missing.md": linkTo("BL-4", "0196f3c2-9c00-7000-8000-000000000004", MISSING_ID),
  "annex/_structure.yaml": `version: 1
id: ${ANNEX.structure}
name: ${ANNEX.name}
prefix: KAX
access: hidden
instructions: full
`,
  [`annex/${ANNEX.handle}-plan.md`]: `---
id: ${ANNEX.id}
handle: ${ANNEX.handle}
---
# Kestrel annex plan

The Kestrel annex is never for agents.
`,
};

/** Every string of a hidden structure that must never be in the instructions file. */
export const HIDDEN_STRINGS = [MARKER, ...HIDDEN.ids, ...HIDDEN.handles, HIDDEN.structure, HIDDEN.name, ANNEX.structure, ANNEX.name, ANNEX.handle, ANNEX.id];

/** Any UUID: the file carries handles only, never ids. */
export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The block of one item in a rendered file: from its `### <HANDLE> ` heading to the next heading. */
export const itemBlock = (text: string, handle: string): string | undefined => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`### ${handle} `));
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
};
