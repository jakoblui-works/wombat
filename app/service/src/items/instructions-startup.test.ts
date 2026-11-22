// A workspace's AGENTS.md is written before any agent of that workspace can start. With the render held back on the
// filesystem (instructions-startup-entry.ts) while the workspace is added through POST /workspaces, an agent started
// during the hold gets the rendered file as its system prompt, and the file is in place when the add answers.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { INSTRUCTIONS_FILES } from "../../test/instructions-fixtures.ts";
import { TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { addWorkspace } from "../../test/server-fixtures.ts";
import { PROMPTED, promptText, readInstructions, startRecorded, startService } from "../../test/service-fixtures.ts";

const ENTRY = join(import.meta.dirname, "..", "..", "test", "instructions-startup-entry.ts");

describe("adding a workspace", () => {
  test(
    "AGENTS.md is written before the add answers, and an agent started while it renders gets that file as its prompt",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "wombat-startup-"));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const logPath = join(dir, "startup.jsonl");
      const events = () =>
        existsSync(logPath)
          ? readFileSync(logPath, "utf8")
              .trim()
              .split("\n")
              .map((line) => (JSON.parse(line) as { event: string }).event)
          : [];

      const service = await startService({
        items: INSTRUCTIONS_FILES,
        entry: ENTRY,
        env: ({ itemsRoot }) => ({ WOMBAT_TEST_STARTUP_LOG: logPath, WOMBAT_TEST_HOLD_ITEMS: itemsRoot }),
        add: false,
      });
      let answered = false;
      const adding = addWorkspace(service.api, service.workspace, service.itemsRoot).then((id) => {
        answered = true;
        return id;
      });
      await waitFor("the render to be held", () => events().includes("render_held"));
      expect(answered, "the add answered while its render was held").toBe(false);
      const prompted = startRecorded(service, PROMPTED);

      await adding;
      const atAnswer = readInstructions(service) ?? "(no file)";
      expect(atAnswer, "AGENTS.md when the add answered").toContain("Login times out after 30 seconds");
      expect(promptText((await prompted).sessionNew), "the prompt of the agent started during the render").toBe(atAnswer);
      expect(readInstructions(service), "AGENTS.md now, with nothing changed since").toBe(atAnswer);
      expect(events(), "the render was held once").toEqual(["render_held"]);
    },
    TEST_TIMEOUT_MS * 2,
  );
});
