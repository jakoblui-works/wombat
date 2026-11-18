// Shared setup for the instructions-file checks: the access fixture's root with its visible binders marked as
// instructions (bugs and backlog in full, both taking proposals; docs as an index), two backlog items that differ
// only in linking to a hidden item or a missing one, and a second hidden binder that asks for instructions
// (which the schema refuses).
import { ACCESS_FILES, HIDDEN, MARKER } from "./access-fixtures.ts";
import { SETTINGS_FILE } from "../src/items/binders.ts";

/** Adds `instructions: <level>` to a binder's settings, right after its access line. */
const marked = (settings: string | undefined, level: "full" | "index") => {
  if (settings === undefined) throw new Error("instructions-fixtures: no such settings file");
  return settings.replace(/^access: (\w+)$/m, (line) => `${line}\ninstructions: ${level}`);
};

/** A hidden binder that asks for instructions: refused by the schema, so it has no valid settings. */
export const ANNEX = { binder: `${MARKER}-annex`, name: "Kestrel annex", handle: "KAX-1", id: "0196f3c2-9a00-7000-8000-000000000031" } as const;

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
  [`bugs/${SETTINGS_FILE}`]: marked(ACCESS_FILES[`bugs/${SETTINGS_FILE}`], "full"),
  // An edit binder can't be marked (agents could change every later agent's instructions unapproved), so
  // the backlog takes proposals here.
  [`backlog/${SETTINGS_FILE}`]: marked(ACCESS_FILES[`backlog/${SETTINGS_FILE}`]?.replace("access: edit", "access: propose"), "full"),
  [`docs/${SETTINGS_FILE}`]: marked(ACCESS_FILES[`docs/${SETTINGS_FILE}`], "index"),
  "backlog/BL-3-linked-hidden.md": linkTo("BL-3", "0196f3c2-9c00-7000-8000-000000000003", HIDDEN.ids[0]),
  "backlog/BL-4-linked-missing.md": linkTo("BL-4", "0196f3c2-9c00-7000-8000-000000000004", MISSING_ID),
  [`annex/${SETTINGS_FILE}`]: `version: 1
id: ${ANNEX.binder}
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

/** Every string of a hidden binder that must never be in the instructions file. */
export const HIDDEN_STRINGS = [MARKER, ...HIDDEN.ids, ...HIDDEN.handles, HIDDEN.binder, HIDDEN.name, ANNEX.binder, ANNEX.name, ANNEX.handle, ANNEX.id];

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
