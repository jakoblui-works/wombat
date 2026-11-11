// Shared setup for the items tests: a temp items root written from invented but realistic files (a Bugs and a
// Backlog structure in folders, a free-named Docs structure at the root, and, for the invalid-items checks, one
// broken file per way a hand edit can break an item plus a broken `_structure.yaml`), and the catalog and writer
// opened on it with a temp store.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ItemWriteErrorCode } from "@wombat/shared/api";
import { expect, onTestFinished } from "vitest";

import { openCatalog, type Catalog, type LoadedItem } from "../src/items/catalog.ts";
import { ItemWriteError, openWriter, type Writer } from "../src/items/write.ts";
import { openStore, type Store } from "../src/store/store.ts";
import { tempStorePath } from "./store-fixtures.ts";

/** UUIDv7 ids for the hand-made fixture items (version nibble 7, variant 8). */
export const IDS = {
  bug1: "0196f3c2-1a00-7000-8000-000000000001",
  bug2: "0196f3c2-1a00-7000-8000-000000000002",
  bl1: "0196f3c2-2b00-7000-8000-000000000001",
  bl2: "0196f3c2-2b00-7000-8000-000000000002",
  doc1: "0196f3c2-3c00-7000-8000-000000000001",
  doc2: "0196f3c2-3c00-7000-8000-000000000002",
  badYaml: "0196f3c2-4d00-7000-8000-000000000010",
  noTitle: "0196f3c2-4d00-7000-8000-000000000011",
  missingRequired: "0196f3c2-4d00-7000-8000-000000000012",
  unknownOption: "0196f3c2-4d00-7000-8000-000000000013",
  unknownKey: "0196f3c2-4d00-7000-8000-000000000014",
  unknownLink: "0196f3c2-4d00-7000-8000-000000000015",
  duplicateId: "0196f3c2-4d00-7000-8000-000000000016",
  duplicateHandleA: "0196f3c2-4d00-7000-8000-000000000018",
  duplicateHandleB: "0196f3c2-4d00-7000-8000-000000000019",
  aliasClashA: "0196f3c2-4d00-7000-8000-000000000020",
  aliasClashB: "0196f3c2-4d00-7000-8000-000000000021",
} as const;

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BUGS_SETTINGS = `version: 1
id: bugs
name: Bugs
prefix: BUG
access: propose
properties:
  repo: { type: select, options: [site-web, api], required: true }
  noted: { type: date }
  order: { type: number }
  note: { type: text }
  blocks: { type: link, to: backlog }
views:
  - { name: By repo, kind: board, column: repo }
`;

export const BACKLOG_SETTINGS = `version: 1
id: backlog
name: Backlog
prefix: BL
access: edit
properties:
  project: { type: select, options: [platform, wombat] }
  parent: { type: link, to: backlog }
views:
  - { name: Tree, kind: tree, parent: parent }
`;

export const DOCS_SETTINGS = `version: 1
id: docs
name: Docs
prefix: DOC
access: read
naming: free
include: ["architecture.md", "guides/*.md"]
`;

/** A valid root: two bugs, two backlog items (BL-1 was BL-3 once), two docs. */
export const VALID_FILES: Record<string, string> = {
  "_structure.yaml": DOCS_SETTINGS,
  "architecture.md": `---
id: ${IDS.doc1}
handle: DOC-1
---
# Architecture

The site talks to the api through \`/api\`; the api owns Postgres and Redis.
`,
  "guides/setup.md": `---
id: ${IDS.doc2}
handle: DOC-2
---
# Setting up a laptop

1. Install pnpm.
2. Run \`pnpm install\` in each repo.
`,
  "roadmap.md": "# Roadmap\n\nNot in any structure: Docs doesn't include it.\n",
  "bugs/_structure.yaml": BUGS_SETTINGS,
  "bugs/BUG-1-login-times-out.md": `---
id: ${IDS.bug1}
handle: BUG-1
# reproduced on staging only
repo: api
noted: 2026-11-02
order: 2
note: Seen after the session cookie change
blocks: ${IDS.bl1}
---
# Login times out after 30 seconds

Steps:
1. Sign in on staging.
2. Wait on the dashboard.

The request to \`/session\` never answers.
`,
  "bugs/hero-caption.md": `---
id: ${IDS.bug2}
handle: BUG-2
repo: site-web
---
# The hero caption overlaps the image at 1280×720

Seen in Zen and Chromium.
`,
  "backlog/_structure.yaml": BACKLOG_SETTINGS,
  "backlog/BL-1-items-in-wombat.md": `---
id: ${IDS.bl1}
handle: BL-1
aliases: [BL-3]
project: wombat
---
# Items in Wombat

Structures, item files and proposals.
`,
  "backlog/BL-2-proposal-view.md": `---
id: ${IDS.bl2}
handle: BL-2
project: wombat
parent: ${IDS.bl1}
---
# A view for proposals

Step 7.
`,
};

const bug = (id: string, handle: string, frontmatter: string, rest = "# A broken bug\n\nIt broke by hand.\n") =>
  `---\nid: ${id}\nhandle: ${handle}\n${frontmatter}---\n${rest}`;

/**
 * One file per way a hand edit can break an item, each in Bugs, and what its problem must name: one of `fields`
 * (in `field` or the message) or, for unparsable YAML, a line.
 */
export const INVALID_BUGS: { file: string; what: string; names: { fields: string[] } | { line: true }; text: string }[] = [
  {
    file: "BUG-10-bad-yaml.md",
    what: "broken YAML",
    names: { line: true },
    text: `---\nid: ${IDS.badYaml}\nhandle: BUG-10\nrepo: [api\n---\n# Broken YAML\n\nThe bracket never closes.\n`,
  },
  {
    file: "BUG-11-no-title.md",
    what: "no H1 title",
    names: { fields: ["title"] },
    text: bug(IDS.noTitle, "BUG-11", "repo: api\n", "## Steps\n\nThe first heading is an H2.\n"),
  },
  {
    file: "BUG-12-missing-repo.md",
    what: "a missing required property",
    names: { fields: ["repo"] },
    text: bug(IDS.missingRequired, "BUG-12", "noted: 2026-11-03\n"),
  },
  {
    file: "BUG-13-unknown-repo.md",
    what: "an unknown select value",
    names: { fields: ["repo"] },
    text: bug(IDS.unknownOption, "BUG-13", "repo: mobile\n"),
  },
  {
    file: "BUG-14-unknown-key.md",
    what: "an unknown frontmatter key",
    names: { fields: ["severity"] },
    text: bug(IDS.unknownKey, "BUG-14", "repo: api\nseverity: high\n"),
  },
  {
    file: "BUG-15-unknown-link.md",
    what: "a link to an unknown handle",
    names: { fields: ["blocks", "BL-99"] },
    text: bug(IDS.unknownLink, "BUG-15", "repo: api\nblocks: BL-99\n"),
  },
  {
    file: "BUG-16-copied.md",
    what: "a duplicate id (first copy)",
    names: { fields: ["id"] },
    text: bug(IDS.duplicateId, "BUG-16", "repo: api\n"),
  },
  {
    file: "BUG-17-copy-of-16.md",
    what: "a duplicate id (second copy)",
    names: { fields: ["id"] },
    text: bug(IDS.duplicateId, "BUG-17", "repo: api\n"),
  },
  {
    file: "BUG-18-first.md",
    what: "a duplicate handle (first)",
    names: { fields: ["handle"] },
    text: bug(IDS.duplicateHandleA, "BUG-18", "repo: api\n"),
  },
  {
    file: "BUG-18-second.md",
    what: "a duplicate handle (second)",
    names: { fields: ["handle"] },
    text: bug(IDS.duplicateHandleB, "BUG-18", "repo: site-web\n"),
  },
  {
    file: "BUG-19-handle.md",
    what: "a handle that is another item's alias",
    names: { fields: ["handle", "aliases"] },
    text: bug(IDS.aliasClashA, "BUG-19", "repo: api\n"),
  },
  {
    file: "BUG-20-alias.md",
    what: "an alias that is another item's handle",
    names: { fields: ["handle", "aliases"] },
    text: bug(IDS.aliasClashB, "BUG-20", "aliases: [BUG-19]\nrepo: api\n"),
  },
];

/** A structure whose settings don't parse; its file must not be loaded anywhere. */
export const BROKEN_STRUCTURE_FILES: Record<string, string> = {
  "broken/_structure.yaml": "version: 1\nid: broken\nname: [Broken\n",
  "broken/BRK-1-orphan.md": "---\nhandle: BRK-1\n---\n# An item in a broken structure\n",
};

/** The valid root plus every invalid bug and the broken structure. */
export const FIXTURE_FILES: Record<string, string> = {
  ...VALID_FILES,
  ...Object.fromEntries(INVALID_BUGS.map(({ file, text }) => [`bugs/${file}`, text])),
  ...BROKEN_STRUCTURE_FILES,
};

/** Writes `files` (paths relative to the root) into a fresh temp root, removed after the test. */
export const writeRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "wombat-items-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) writeAt(root, path, text);
  return root;
};

export const writeAt = (root: string, path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

export const readAt = (root: string, path: string) => readFileSync(join(root, path), "utf8");

/** The `.md` files directly in a folder of the root. */
export const mdFilesIn = (root: string, folder: string) =>
  readdirSync(join(root, folder)).filter((name) => name.endsWith(".md"));

export type Opened = {
  root: string;
  storePath: string;
  store: Store;
  catalog: Catalog;
  writer: Writer;
  /** Closes the store and opens store, catalog and writer again on the same files, as after a restart. */
  reopen: () => Opened;
};

/** The catalog and writer on `root`, with a store at `storePath` (a fresh one by default). */
export const openItems = (root: string, storePath = tempStorePath()): Opened => {
  const store = openStore({ path: storePath });
  let closed = false;
  const close = () => {
    if (!closed) store.close();
    closed = true;
  };
  onTestFinished(close);
  const catalog = openCatalog({ root, store });
  const writer = openWriter({ root, store });
  return {
    root,
    storePath,
    store,
    catalog,
    writer,
    reopen: () => {
      close();
      return openItems(root, storePath);
    },
  };
};

/** The item read from `path` (relative to the root); fails the test when none or several are listed. */
export const itemAt = (items: LoadedItem[], path: string): LoadedItem => {
  const found = items.filter((item) => item.path === path || item.path.endsWith(`/${path}`));
  expect(found.map((item) => item.path), `items read from ${path}`).toHaveLength(1);
  return found[0] as LoadedItem;
};

/** Asserts that `promise` is refused with an ItemWriteError of `code`. */
export const expectWriteError = async (promise: Promise<unknown>, code: ItemWriteErrorCode, what = "") => {
  let error: unknown;
  try {
    await promise;
  } catch (thrown) {
    error = thrown;
  }
  expect(error, `${what}: expected an ItemWriteError ${code}`).toBeInstanceOf(ItemWriteError);
  expect((error as ItemWriteError).code, what).toBe(code);
};

/**
 * A leading frontmatter block: an optional UTF-8 BOM, `---` alone on the first line, then lines up to the next
 * `---` alone on a line; LF or CRLF. Groups: the opening fence, the lines between, the closing fence.
 */
const FRONTMATTER = /^(\uFEFF?---\r?\n)((?:.*\r?\n)*?)(---\r?\n)/;

/** The lines of a text's leading frontmatter block, each with its line ending; undefined when there is none. */
const frontmatterLines = (text: string) => {
  const match = FRONTMATTER.exec(text);
  if (match === null) return undefined;
  const lines = (match[2] ?? "").split(/(?<=\n)/).filter((line) => line !== "");
  return { match, lines };
};

/**
 * The text with the lines `id: …` and `handle: …` removed from its leading frontmatter block (at any indent, with
 * either line ending), and a block that held nothing else removed whole: what a hand-made file looked like before
 * the service assigned them.
 */
export const withoutAssigned = (text: string): string => {
  const found = frontmatterLines(text);
  if (found === undefined) return text;
  const { match, lines } = found;
  const kept = lines.filter((line) => !/^[ \t]*(id|handle):[ \t]/.test(line));
  const rest = text.slice(match[0].length);
  if (kept.length === 0 && lines.length > 0) return rest;
  return `${match[1] ?? ""}${kept.join("")}${match[3] ?? ""}${rest}`;
};

/** The keys of a text's leading frontmatter block (`key:` lines at any indent, not comments). */
export const frontmatterKeys = (text: string): string[] =>
  (frontmatterLines(text)?.lines ?? [])
    .map((line) => /^[ \t]*([A-Za-z_][\w-]*):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);

/** The value of a frontmatter key as written, without quotes. */
export const frontmatterValue = (text: string, key: string): string | undefined => {
  const line = (frontmatterLines(text)?.lines ?? []).map((candidate) => candidate.trim()).find((candidate) => candidate.startsWith(`${key}:`));
  return line
    ?.slice(key.length + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
};

/** The number of a handle like `BL-12`. */
export const handleNumber = (handle: string | null) => {
  const match = /^[A-Z][A-Z0-9]*-(\d+)$/.exec(handle ?? "");
  expect(match, `${String(handle)} is a handle with a number`).not.toBeNull();
  return Number(match?.[1]);
};
