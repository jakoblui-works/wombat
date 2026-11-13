// Property names on a write are data, looked up as own keys only: a name every object has (`toString`,
// `__proto__`) is an unknown property unless the structure declares it, and a declared one the
// caller leaves out is left out.
import { describe, expect, test } from "vitest";

import { ItemWriteError } from "./write.ts";
import { VALID_FILES, expectWriteError, mdFilesIn, openItems, writeRoot } from "../../test/items-fixtures.ts";

describe("property names on a write", () => {
  test.each(["__proto__"])("a new item's undeclared %s is refused by name, and nothing is written", async (key) => {
    const root = writeRoot(VALID_FILES);
    const { writer } = openItems(root);
    const before = mdFilesIn(root, "bugs");
    // Parsed from JSON, as a tool call's input is, so `__proto__` is a key and not the prototype.
    const properties = JSON.parse(`{ "repo": "api", ${JSON.stringify(key)}: "hi" }`) as Record<string, unknown>;

    const refused = writer.createItem("bugs", { title: "A key named like a member", body: "", properties });

    await expectWriteError(refused, "invalid_fields", key);
    const error = await refused.catch((thrown: unknown) => thrown as ItemWriteError);
    expect(error.problems.map((problem) => problem.field)).toContain(key);
    expect(mdFilesIn(root, "bugs")).toEqual(before);
  });
});
