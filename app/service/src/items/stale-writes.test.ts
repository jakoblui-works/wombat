// Lasting check (silent failure), the writer's half of "Approve never overwrites": every write takes
// the version it was based on and is refused when the file changed since, leaving the file exactly as it is.
// Without it a hand edit (or a parallel write) is lost with nothing showing it. Approving a proposal relies on it.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ItemWriteError } from "./write.ts";
import { VALID_FILES, expectWriteError, itemAt, openItems, readAt, writeAt, writeRoot } from "../../test/items-fixtures.ts";

const FILE = "bugs/BUG-1-login-times-out.md";

describe("stale writes are refused", () => {
  test("an update or a delete based on the version before a hand edit is refused and the edit stays", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const before = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE);
    const handEdited = `${readAt(root, FILE)}\nAlso seen on production, 2026-11-08.\n`;
    writeAt(root, FILE, handEdited);

    await expectWriteError(writer.updateItem("BUG-1", { repo: "site-web" }, before.version), "stale_version", "update");
    await expectWriteError(writer.updateItem("BUG-1", { body: "Replaced.\n" }, before.version), "stale_version", "body update");
    await expectWriteError(writer.deleteItem("BUG-1", before.version), "stale_version", "delete");

    expect(existsSync(join(root, FILE))).toBe(true);
    expect(readAt(root, FILE)).toBe(handEdited);
  });

  test("two updates at once on the same base: exactly one lands, the other is refused", async () => {
    const root = writeRoot(VALID_FILES);
    const { catalog, writer } = openItems(root);
    const base = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE).version;

    const results = await Promise.allSettled([
      writer.updateItem("BUG-1", { repo: "site-web" }, base),
      writer.updateItem("BUG-1", { note: "Changed by the second writer" }, base),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.reason).toBeInstanceOf(ItemWriteError);
    expect((refused?.reason as ItemWriteError).code).toBe("stale_version");
    const item = itemAt((await catalog.snapshot()).items.filter((item) => item.structure === "bugs"), FILE);
    const landed = [item.properties.repo === "site-web", item.properties.note === "Changed by the second writer"];
    expect(landed.filter(Boolean)).toHaveLength(1);
  });
});
