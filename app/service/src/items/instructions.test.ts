// The instructions file itself: nothing of a hidden structure is ever in it
// (a link to a hidden item reads like a missing one), it carries handles and never ids; an item that is invalid on
// disk neither breaks it nor brings problem text into it, nor leaves an empty heading; it is written atomically,
// read-only, rewritable, and kept as it was when a render fails; and an approved create or delete is in it before
// the approval answers. The service's wiring (start, writes, watching, the agents' prompt) is checked in
// instructions-service.test.ts and instructions-startup.test.ts.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { openAccess } from "./access.ts";
import { INSTRUCTIONS_FILE, openInstructions, refreshingWriter, renderInstructions, writeInstructions } from "./instructions.ts";
import { AGENT, leaks } from "../../test/access-fixtures.ts";
import { HIDDEN_STRINGS, INSTRUCTIONS_FILES, UUID, itemBlock } from "../../test/instructions-fixtures.ts";
import { openItems, writeRoot } from "../../test/items-fixtures.ts";

const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
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

  test("an approved create and an approved delete are in the file before the approval answers", async () => {
    const root = writeRoot(INSTRUCTIONS_FILES);
    const { catalog, writer, store } = openItems(root);
    const workspaceRoot = workspace();
    const path = join(workspaceRoot, INSTRUCTIONS_FILE);
    // No watcher: only the writes' own refresh can bring a change into the file.
    const instructions = openInstructions({ catalog, workspaceRoot, itemsRoot: root, log: () => undefined });
    onTestFinished(() => instructions.close());
    const access = openAccess({ catalog, writer: refreshingWriter(writer, instructions.refresh), store, onProposal: () => undefined });
    await instructions.refresh();
    expect(readFileSync(path, "utf8")).toContain("The hero caption overlaps the image");

    const created = await access.proposeCreate(AGENT, "bugs", { title: "Search ignores accents", body: "\nInvented.\n" }, "Seen in the search box.");
    expect(readFileSync(path, "utf8"), "a pending create").not.toContain("Search ignores accents");
    expect((await access.approve(created.proposed)).status).toBe("approved");
    expect(readFileSync(path, "utf8"), "right after the approved create").toContain("Search ignores accents");

    const { version } = await access.get("BUG-2");
    const deleted = await access.proposeDelete(AGENT, "BUG-2", version, "Fixed by the new layout.");
    expect((await access.approve(deleted.proposed)).status).toBe("approved");
    expect(readFileSync(path, "utf8"), "right after the approved delete").not.toContain("The hero caption overlaps the image");
  });

  test("a file over the cap is sent as an index of every structure, and one under it in full", async () => {
    const catalog = openItems(
      writeRoot({
        "rules/_structure.yaml": "version: 1\nid: rules\nname: Rules\nprefix: RUL\naccess: propose\ninstructions: full\n",
        "rules/RUL-1-a.md": "---\nid: 0196f3c2-9e00-7000-8000-000000000001\nhandle: RUL-1\n---\n# Rule one\nFirst line of rule one.\n\nA second paragraph only the full text has.\n",
      }),
    ).catalog;
    const full = (await renderInstructions(catalog)) ?? "";
    expect(full).toContain("A second paragraph only the full text has.");

    const capped = (await renderInstructions(catalog, { maxBytes: Buffer.byteLength(full) - 1 })) ?? "";
    expect(capped).toContain("First line of rule one.");
    expect(capped).not.toContain("A second paragraph only the full text has.");
    expect(await renderInstructions(catalog, { maxBytes: Buffer.byteLength(full) })).toBe(full);
  });
});
