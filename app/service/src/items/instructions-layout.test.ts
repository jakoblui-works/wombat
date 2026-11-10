// The instructions file's layout (D27): full and index sections, the order of structures and items, and link values
// as handles. What must never reach the file (hidden items, ids, problems) is checked in instructions.test.ts.
import { describe, expect, test } from "vitest";

import { INDEX_LINE_MAX, INSTRUCTIONS_HEADER, renderInstructions } from "./instructions.ts";
import { openItems, writeRoot } from "../../test/items-fixtures.ts";

const id = (n: number) => `0196f3c2-9d00-7000-8000-${String(n).padStart(12, "0")}`;

const item = (n: number, handle: string, title: string, frontmatter = "", body = "") =>
  `---\nid: ${id(n)}\nhandle: ${handle}\n${frontmatter}---\n# ${title}\n${body}`;

const render = async (files: Record<string, string>) => (await renderInstructions(openItems(writeRoot(files)).catalog)) ?? "";

describe("the instructions file's layout", () => {
  test("full: a header, a section per structure, each item's heading, its properties on one line, then its body", async () => {
    const text = await render({
      "rules/_structure.yaml": "version: 1\nid: rules\nname: Rules\nprefix: RUL\naccess: read\ninstructions: full\nproperties:\n  area: { type: select, options: [web, api] }\n  note: { type: text }\n",
      "rules/RUL-1-a.md": item(1, "RUL-1", "Name branches after the task", "area: api\nnote: Since May\n", "\nUse the handle.\n\n## Why\n\nTraceable.\n"),
      "rules/RUL-2-b.md": item(2, "RUL-2", "No body"),
    });

    expect(text).toBe(
      [
        INSTRUCTIONS_HEADER,
        "",
        "## Rules",
        "",
        "### RUL-1 Name branches after the task",
        "area: api; note: Since May",
        "",
        "Use the handle.",
        "",
        // A body heading moves down, so it never reads as a section or an item of the file.
        "##### Why",
        "",
        "Traceable.",
        "",
        "### RUL-2 No body",
        "",
      ].join("\n"),
    );
  });

  test("index: each item's title and its first body line, capped; nothing more for an item without a body; a get_item pointer", async () => {
    const long = "word ".repeat(INDEX_LINE_MAX);
    const text = await render({
      "docs/_structure.yaml": "version: 1\nid: docs\nname: Docs\nprefix: DOC\naccess: read\ninstructions: index\n",
      "docs/DOC-1-a.md": item(1, "DOC-1", "Architecture", "", "\n\n  The site talks to the api.  \nMore detail that stays out.\n"),
      "docs/DOC-2-b.md": item(2, "DOC-2", "Long one", "", `\n${long}\n`),
      "docs/DOC-3-c.md": item(3, "DOC-3", "Empty"),
    });

    const lines = text.split("\n");
    expect(lines.slice(2, 5)).toEqual(["## Docs", "", expect.stringContaining("get_item")]);
    expect(lines[lines.indexOf("### DOC-1 Architecture") + 1]).toBe("The site talks to the api.");
    expect(text).not.toContain("More detail");
    const capped = lines[lines.indexOf("### DOC-2 Long one") + 1] ?? "";
    expect(capped.endsWith("…")).toBe(true);
    expect(Array.from(capped).length).toBeLessThanOrEqual(INDEX_LINE_MAX);
    expect(lines.slice(lines.indexOf("### DOC-3 Empty"))).toEqual(["### DOC-3 Empty", ""]);
  });

  test("structures by id and items by the first view's sort, else by handle number; a structure with instructions off is left out", async () => {
    const text = await render({
      "zeta/_structure.yaml": "version: 1\nid: zeta\nname: Zeta\nprefix: ZET\naccess: read\ninstructions: full\n",
      "zeta/ZET-10-a.md": item(1, "ZET-10", "Ten"),
      "zeta/ZET-2-b.md": item(2, "ZET-2", "Two"),
      "alpha/_structure.yaml":
        "version: 1\nid: alpha\nname: Alpha\nprefix: ALP\naccess: read\ninstructions: full\nproperties:\n  rank: { type: select, options: [high, low] }\nviews:\n  - { name: List, kind: list, sort: [rank] }\n",
      "alpha/ALP-1-a.md": item(3, "ALP-1", "Low", "rank: low\n"),
      "alpha/ALP-2-b.md": item(4, "ALP-2", "Unranked"),
      "alpha/ALP-3-c.md": item(5, "ALP-3", "High", "rank: high\n"),
      "quiet/_structure.yaml": "version: 1\nid: quiet\nname: Quiet\nprefix: QUI\naccess: read\ninstructions: off\n",
      "quiet/QUI-1-a.md": item(6, "QUI-1", "Never in the file"),
    });

    const headings = text.split("\n").filter((line) => line.startsWith("#"));
    expect(headings).toEqual(["## Alpha", "### ALP-3 High", "### ALP-1 Low", "### ALP-2 Unranked", "## Zeta", "### ZET-2 Two", "### ZET-10 Ten"]);
  });

  test("a link reads as the target's handle; a link to a missing item is left out", async () => {
    const text = await render({
      "plans/_structure.yaml": "version: 1\nid: plans\nname: Plans\nprefix: PLN\naccess: read\ninstructions: full\nproperties:\n  parent: { type: link, to: plans }\n",
      "plans/PLN-1-a.md": item(1, "PLN-1", "Root"),
      "plans/PLN-2-b.md": item(2, "PLN-2", "Child", `parent: ${id(1)}\n`),
      "plans/PLN-3-c.md": item(3, "PLN-3", "Orphan", `parent: ${id(99)}\n`),
    });

    const lines = text.split("\n");
    expect(lines[lines.indexOf("### PLN-2 Child") + 1]).toBe("parent: PLN-1");
    expect(lines[lines.indexOf("### PLN-3 Orphan") + 1]).toBe("");
  });
});
