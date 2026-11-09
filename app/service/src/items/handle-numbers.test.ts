// Lasting check (silent failure): a deleted item's handle number is never given again, also after a
// restart. Otherwise a new BL-4 silently takes over every reference to the deleted BL-4.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { VALID_FILES, handleNumber, openItems, writeRoot } from "../../test/items-fixtures.ts";

const idea = (title: string) => ({ title, body: "\nInvented for the test.\n", properties: { project: "wombat" } });

describe("handle numbers", () => {
  test("a deleted item's number is never given again, before or after a restart", async () => {
    const root = writeRoot(VALID_FILES);
    const first = openItems(root);
    const given: number[] = [];

    const a = await first.writer.createItem("backlog", idea("First idea"));
    given.push(handleNumber(a.handle));
    await first.writer.deleteItem(a.handle ?? "", a.version);
    expect(existsSync(join(root, a.path))).toBe(false);
    expect(await first.catalog.resolve(a.handle ?? "")).toBeUndefined();

    const b = await first.writer.createItem("backlog", idea("Second idea"));
    given.push(handleNumber(b.handle));
    await first.writer.deleteItem(b.handle ?? "", b.version);

    // The deleted ones were the highest numbers; only the store remembers them now.
    const restarted = first.reopen();
    const c = await restarted.writer.createItem("backlog", idea("Third idea"));

    expect(handleNumber(b.handle)).toBeGreaterThan(handleNumber(a.handle));
    expect(handleNumber(c.handle)).toBeGreaterThan(Math.max(...given));
  });
});
