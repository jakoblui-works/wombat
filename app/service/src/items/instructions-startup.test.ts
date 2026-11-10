// Lasting check (silent failure): the service renders AGENTS.md before it can take agents. With the start-up
// render held back on the filesystem (instructions-startup-entry.ts), the instructions file is already in place
// when the discovery file lands (the moment the app can find the service), and the first agent started gets
// exactly that file as its system prompt.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { INSTRUCTIONS_FILES } from "../../test/instructions-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import { PROMPTED, promptText, readInstructions, startRecorded, startService } from "../../test/service-fixtures.ts";

const ENTRY = join(import.meta.dirname, "..", "..", "test", "instructions-startup-entry.ts");

describe("start-up", () => {
  test(
    "AGENTS.md is written before the service can be found, and the first agent's prompt is that file",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "wombat-startup-"));
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
      const logPath = join(dir, "startup.jsonl");

      const service = await startService({ items: INSTRUCTIONS_FILES, entry: ENTRY, env: { WOMBAT_TEST_STARTUP_LOG: logPath } });
      const prompted = await startRecorded(service, PROMPTED);

      const events = readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event: string; instructions?: string | null });
      expect(events.map(({ event }) => event), "the render was held, then the discovery file written").toEqual(["render_held", "discovery_written"]);
      const atDiscovery = events[1]?.instructions ?? "(no file)";
      expect(atDiscovery, "AGENTS.md when the discovery file landed").toContain("Login times out after 30 seconds");
      expect(readInstructions(service), "AGENTS.md now, with nothing changed since").toBe(atDiscovery);
      expect(promptText(prompted.sessionNew), "the first agent's prompt").toBe(atDiscovery);
    },
    TEST_TIMEOUT_MS * 2,
  );
});
