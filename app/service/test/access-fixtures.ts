// Shared setup for the access-level tests (the access module and the MCP endpoint): an invented items root with
// one structure per access level, locked fields, and a hidden structure whose every name, handle, title, body and
// value carries a marker, plus helpers to snapshot the root and to read what an agent was given.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { Problem } from "@wombat/shared/items";
import { expect } from "vitest";

import { AccessError, openAccess, type Access, type AccessErrorCode } from "../src/items/access.ts";
import { openItems, writeRoot, type Opened } from "./items-fixtures.ts";

/** In every name, title, body and value of the hidden structure, in mixed case; never in a visible one. */
export const MARKER = "kestrel";

export const HIDDEN = {
  structure: "kestrel-vault",
  name: "Kestrel vault",
  prefix: "KST",
  handles: ["KST-1", "KST-2"],
  ids: ["0196f3c2-9a00-7000-8000-000000000001", "0196f3c2-9a00-7000-8000-000000000002"],
} as const;

export const VISIBLE_IDS = {
  bug1: "0196f3c2-9b00-7000-8000-000000000001",
  bug2: "0196f3c2-9b00-7000-8000-000000000002",
  bl1: "0196f3c2-9c00-7000-8000-000000000001",
  bl2: "0196f3c2-9c00-7000-8000-000000000002",
  doc1: "0196f3c2-9d00-7000-8000-000000000001",
} as const;

/** The agent the access tests act as. */
export const AGENT = "agent-access-test";

export const ACCESS_FILES: Record<string, string> = {
  // propose; `repo` and the body are locked; `vault` links into the hidden structure.
  "bugs/_structure.yaml": `version: 1
id: bugs
name: Bugs
prefix: BUG
access: propose
locked: [repo, body]
properties:
  repo: { type: select, options: [site-web, api] }
  note: { type: text }
  vault: { type: link, to: ${HIDDEN.structure} }
`,
  "bugs/BUG-1-login-times-out.md": `---
id: ${VISIBLE_IDS.bug1}
handle: BUG-1
repo: api
note: Plan to retry the session call
vault: ${HIDDEN.ids[0]}
---
# Login times out after 30 seconds

The plan: retry once, then show the sign-in page.
`,
  "bugs/BUG-2-hero-caption.md": `---
id: ${VISIBLE_IDS.bug2}
handle: BUG-2
repo: site-web
---
# The hero caption overlaps the image

Seen in Zen at 1280×720.
`,
  // edit; the title and `project` are locked.
  "backlog/_structure.yaml": `version: 1
id: backlog
name: Backlog
prefix: BL
access: edit
locked: [title, project]
properties:
  project: { type: select, options: [platform, wombat] }
  owner: { type: text }
  parent: { type: link, to: backlog }
`,
  "backlog/BL-1-items.md": `---
id: ${VISIBLE_IDS.bl1}
handle: BL-1
project: wombat
owner: Sam
---
# Items in Wombat

The plan for structures and proposals.
`,
  "backlog/BL-2-proposal-view.md": `---
id: ${VISIBLE_IDS.bl2}
handle: BL-2
project: wombat
parent: ${VISIBLE_IDS.bl1}
---
# A view for proposals

Plan it after the routes.
`,
  // read
  "docs/_structure.yaml": `version: 1
id: docs
name: Docs
prefix: DOC
access: read
`,
  "docs/DOC-1-architecture.md": `---
id: ${VISIBLE_IDS.doc1}
handle: DOC-1
---
# Architecture

The site talks to the api; the plan is in the roadmap.
`,
  // hidden
  [`vault/_structure.yaml`]: `version: 1
id: ${HIDDEN.structure}
name: ${HIDDEN.name}
prefix: ${HIDDEN.prefix}
access: hidden
properties:
  codename: { type: text }
`,
  "vault/KST-1-plan.md": `---
id: ${HIDDEN.ids[0]}
handle: ${HIDDEN.handles[0]}
codename: Kestrel-Prime
---
# Kestrel plan

The plan for the KESTREL launch, never for agents.
`,
  "vault/KST-2-notes.md": `---
id: ${HIDDEN.ids[1]}
handle: ${HIDDEN.handles[1]}
codename: kestrel-two
---
# Notes on the Kestrel launch

Plan B for kestrel.
`,
};

/** Every file under `root` (relative path → contents), for checking that nothing changed. */
export const snapshotFiles = (root: string): Record<string, string> => {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return files;
};

export type AccessSetup = Opened & { access: Access; announced: string[] };

/** The access module on a fresh copy of `files` (ACCESS_FILES by default); proposal announcements are recorded. */
export const openAccessRoot = (files: Record<string, string> = ACCESS_FILES): AccessSetup => {
  const opened = openItems(writeRoot(files));
  const announced: string[] = [];
  const access = openAccess({
    catalog: opened.catalog,
    writer: opened.writer,
    store: opened.store,
    onProposal: (id) => announced.push(id),
  });
  return { ...opened, access, announced };
};

/** The AccessError a call was refused with; fails the test when it resolved or threw something else. */
export const refusal = async (call: Promise<unknown>, what: string): Promise<AccessError> => {
  let error: unknown;
  try {
    await call;
  } catch (thrown) {
    error = thrown;
  }
  expect(error, `${what}: expected an AccessError`).toBeInstanceOf(AccessError);
  return error as AccessError;
};

/** Asserts a refusal with `code`, and returns its message. */
export const expectRefused = async (call: Promise<unknown>, code: AccessErrorCode, what: string) => {
  const error = await refusal(call, what);
  expect(error.code, `${what}: ${error.message}`).toBe(code);
  expect(error.message.trim().length, `${what}: the message says what to do`).toBeGreaterThan(0);
  return error.message;
};

/** The hidden structure's strings an agent must never see unless it typed them itself. */
export const hiddenStrings = () => [MARKER, ...HIDDEN.ids];

/** The hidden strings (case-insensitive) found in `text`. */
export const leaks = (text: string, strings: readonly string[] = hiddenStrings()) =>
  strings.filter((needle) => text.toLowerCase().includes(needle.toLowerCase()));

/** The keys the shared Problem has: anything else on a problem (the service's own `names`) mustn't leave the service. */
const PROBLEM_KEYS = new Set(Object.keys(Problem.shape));

/**
 * Every key beyond the shared Problem's on a problem anywhere in `value` (a `problems` list or a `problem`),
 * as `<path>: <key>`. Walks the value as sent: give it the raw JSON, not a schema-parsed copy, which drops keys.
 */
export const extraProblemKeys = (value: unknown, path = "$"): string[] => {
  if (Array.isArray(value)) return value.flatMap((entry, index) => extraProblemKeys(entry, `${path}[${String(index)}]`));
  if (typeof value !== "object" || value === null) return [];
  const extra: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const problems = key === "problems" && Array.isArray(entry) ? entry : key === "problem" && typeof entry === "object" && entry !== null ? [entry] : [];
    for (const problem of problems) {
      for (const name of Object.keys(problem as object)) if (!PROBLEM_KEYS.has(name)) extra.push(`${path}.${key}: ${name}`);
    }
    extra.push(...extraProblemKeys(entry, `${path}.${key}`));
  }
  return extra;
};
