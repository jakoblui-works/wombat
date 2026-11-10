// Lasting checks (silent failures) on the instructions file itself (T9): nothing of a hidden structure is ever in it
// (a link to a hidden item reads like a missing one), it carries handles and never ids; an item that is invalid on
// disk neither breaks it nor brings problem text into it; and it is written atomically, read-only, rewritable,
// and kept as it was when a render fails. The service's wiring (start, writes, watching, the agents' prompt) is
// checked in instructions-service.test.ts.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import type { Catalog } from "./catalog.ts";
import { INSTRUCTIONS_FILE, renderInstructions, writeInstructions } from "./instructions.ts";
import { leaks } from "../../test/access-fixtures.ts";
import { HIDDEN_STRINGS, INSTRUCTIONS_FILES, UUID, itemBlock } from "../../test/instructions-fixtures.ts";
import { openItems, writeRoot } from "../../test/items-fixtures.ts";

const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** Every problem message the catalog reports for the root: none may reach the file. */
const problemTexts = async (catalog: Catalog) => {
  const texts: string[] = [];
  for (const structure of await catalog.structures()) {
    texts.push(...structure.problems.map((problem) => problem.message));
    if (structure.id !== null) for (const item of await catalog.items(structure.id)) texts.push(...item.problems.map((problem) => problem.message));
  }
  return texts;
};

describe("the instructions file", () => {
  test("carries nothing of a hidden structure and no ids, and a link to a hidden item reads like a link to a missing one", async () => {
    const { catalog } = openItems(writeRoot(INSTRUCTIONS_FILES));

    const text = (await renderInstructions(catalog)) ?? "";

    // It rendered the visible instructions structures, so the checks below look at a real file.
    for (const visible of ["BUG-1", "Login times out after 30 seconds", "BL-1", "BL-3", "BL-4", "DOC-1"]) expect(text).toContain(visible);
    expect(leaks(text, HIDDEN_STRINGS), "hidden strings in the file").toEqual([]);
    expect(UUID.exec(text)?.[0], "an id in the file").toBeUndefined();
    // BL-3 links to a hidden item and BL-4 to a missing one; otherwise the files are the same.
    const linkedHidden = itemBlock(text, "BL-3");
    expect(linkedHidden, "BL-3's block").toBeDefined();
    expect(linkedHidden?.replaceAll("BL-3", "<handle>")).toBe(itemBlock(text, "BL-4")?.replaceAll("BL-4", "<handle>"));
  });

  test("an item invalid on disk neither breaks the file nor brings problem text into it", async () => {
    const conventions = `version: 1
id: conventions
name: Conventions
prefix: CONV
access: propose
instructions: full
properties:
  area: { type: select, options: [frontends, services] }
`;
    const files = {
      "conventions/_structure.yaml": conventions,
      "conventions/CONV-1-valid.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000041\nhandle: CONV-1\narea: services\n---\n# Name branches after the task\n\nvalid-rule-text\n",
      // A value problem: it has a title and a handle, so it renders, without its problem.
      "conventions/CONV-2-unknown-area.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000042\nhandle: CONV-2\narea: everywhere\n---\n# Keep commits small\n\nvalue-problem-rule-text\n",
      // No title: skipped.
      "conventions/CONV-3-no-title.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000043\nhandle: CONV-3\n---\nuntitled-rule-text, with no heading.\n",
      // Unparseable: skipped.
      "conventions/CONV-4-broken.md": "---\nid: [0196f3c2\nhandle: CONV-4\n---\n# A broken rule\n\nunparseable-rule-text\n",
      // Broken settings (an unknown key): the whole structure is skipped.
      "guides/_structure.yaml": "version: 1\nid: guides\nname: Guides\nprefix: GDE\naccess: read\ninstructions: full\ncolour: blue\n",
      "guides/GDE-1-style.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000044\nhandle: GDE-1\n---\n# Style guide\n\nbroken-settings-guide-text\n",
    };
    const { catalog } = openItems(writeRoot(files));
    const problems = await problemTexts(catalog);
    expect(problems.length, "the root has the problems this test is about").toBeGreaterThanOrEqual(4);

    const text = (await renderInstructions(catalog)) ?? "";

    expect(text).toContain("valid-rule-text");
    expect(text, "a value problem doesn't keep an item out").toContain("value-problem-rule-text");
    for (const skipped of ["untitled-rule-text", "unparseable-rule-text", "broken-settings-guide-text", "Style guide"]) expect(text).not.toContain(skipped);
    // Whole messages, and each without its leading `field: `, so a reworded prefix doesn't hide one.
    const fragments = problems.flatMap((message) => [message, message.replace(/^[^:]*: /, "")]);
    expect(fragments.filter((fragment) => text.includes(fragment)), "problem text in the file").toEqual([]);
  });

  test("is written atomically and read-only, rewritten over its read-only self, and kept as it was when a render fails", async () => {
    const root = writeRoot(INSTRUCTIONS_FILES);
    const { catalog } = openItems(root);
    const workspaceRoot = workspace();
    const path = join(workspaceRoot, INSTRUCTIONS_FILE);
    const logs: { event: string; fields: Record<string, unknown> }[] = [];
    const log = (event: string, fields: Record<string, string | number | boolean>) => logs.push({ event, fields });
    const mode = () => (statSync(path).mode & 0o777).toString(8);
    const onlyTheFile = () => expect(readdirSync(join(workspaceRoot, ".wombat")), "nothing else is left in .wombat").toEqual(["AGENTS.md"]);

    await writeInstructions({ catalog, workspaceRoot, log });
    expect(readFileSync(path, "utf8")).toBe(await renderInstructions(catalog));
    expect(mode(), "read-only").toBe("444");
    onlyTheFile();

    // A hand edit, then a second write over the read-only file.
    const docPath = join(root, "docs", "DOC-1-architecture.md");
    writeFileSync(docPath, readFileSync(docPath, "utf8").replace("# Architecture", "# Architecture, revised"));
    await writeInstructions({ catalog, workspaceRoot, log });
    const good = readFileSync(path, "utf8");
    expect(good).toContain("Architecture, revised");
    expect(good).toBe(await renderInstructions(catalog));
    expect(mode()).toBe("444");
    onlyTheFile();

    // A render that fails (the catalog can't be read) keeps the last good file and logs no contents.
    const failing = new Proxy(catalog, {
      get: (target, key) => {
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? () => Promise.reject(new Error("EIO: i/o error, read")) : value;
      },
    });
    await writeInstructions({ catalog: failing, workspaceRoot, log });
    expect(readFileSync(path, "utf8"), "the last good file").toBe(good);
    onlyTheFile();
    const failed = logs.filter((line) => line.event === "instructions_failed");
    expect(failed, "one instructions_failed line").toHaveLength(1);
    expect(JSON.stringify(logs).includes("Login times out"), "file contents in the log").toBe(false);
    expect(existsSync(path)).toBe(true);
  });
});
