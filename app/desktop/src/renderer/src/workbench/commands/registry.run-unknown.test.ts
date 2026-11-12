// A command id no one registered is a mistake in the caller (a menu, a key, a button): running it fails loudly, naming
// the id, instead of doing nothing.
import { expect, test } from "vitest";

import { runCommand } from "./registry.ts";

test("runCommand on an id no command has rejects, naming the id", async () => {
  await expect(runCommand("test.nobody.registered")).rejects.toThrow('"test.nobody.registered"');
});
