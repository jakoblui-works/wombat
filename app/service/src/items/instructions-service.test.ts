// Lasting checks (silent failures and the instructions-file contract, T9) through the service as a process: an
// agent started as soon as the service is up gets exactly `<workspace>/.wombat/AGENTS.md` as the top-level
// `systemPrompt` (mode append) of its session/new, and a harness that doesn't ask gets nothing; a hand edit, a
// service write and an approval each show in the file (a write before its call answers); the file never lands in a
// repo; and with nothing to render, a stale file is removed and no prompt is sent.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

import { INSTRUCTIONS_DEBOUNCE_MS } from "./instructions.ts";
import { ACCESS_FILES, leaks } from "../../test/access-fixtures.ts";
import { HIDDEN_STRINGS, INSTRUCTIONS_FILES } from "../../test/instructions-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import {
  PLAIN,
  PROMPTED,
  agentTool,
  promptText,
  readInstructions,
  startRecorded,
  startService,
  type RunningService,
} from "../../test/service-fixtures.ts";

/** Tolerance on top of the debounce for fs.watch to report a change and the render to finish; not a tuning value. */
const SETTLE_MS = 1_000;

/** Waits until the instructions file passes `check`, for at most the debounce plus the settle tolerance. */
const untilFile = async (service: RunningService, what: string, check: (text: string) => boolean) => {
  const deadline = Date.now() + INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS;
  for (;;) {
    const text = readInstructions(service) ?? "";
    if (check(text)) return text;
    if (Date.now() > deadline) throw new Error(`the instructions file didn't show ${what} within the debounce; it reads:\n${text}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Files named AGENTS.md or CLAUDE.md anywhere under the workspace, relative to it. */
const instructionFiles = (dir: string, root = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return instructionFiles(path, root);
    return /^(agents|claude)\.md$/i.test(entry.name) ? [relative(root, path)] : [];
  });

describe("the instructions file in the service", () => {
  test(
    "an agent started as soon as the service is up gets AGENTS.md as its system prompt; a harness that doesn't ask gets nothing",
    async () => {
      const service = await startService({ items: INSTRUCTIONS_FILES });

      // The first thing after start: no wait for a render.
      const prompted = await startRecorded(service, PROMPTED);
      const file = readInstructions(service);
      expect(file, "AGENTS.md at start").toBeDefined();
      expect(file).toContain("Login times out after 30 seconds");
      expect(prompted.sessionNew.systemPrompt, "the top-level systemPrompt, appended").toMatchObject({ mode: "append" });
      expect(promptText(prompted.sessionNew), "the prompt is the file").toBe(file);
      expect((prompted.sessionNew._meta as Record<string, unknown> | undefined)?.systemPrompt, "never _meta.systemPrompt").toBeUndefined();
      expect(leaks(JSON.stringify(prompted.sessionNew), HIDDEN_STRINGS), "hidden strings in session/new").toEqual([]);

      // A harness without the hook: the same session/new, without anything it didn't ask for.
      const plain = await startRecorded(service, PLAIN);
      expect(Object.keys(plain.sessionNew).sort()).toEqual(Object.keys(prompted.sessionNew).filter((key) => key !== "systemPrompt").sort());
      expect(JSON.stringify(plain.sessionNew)).not.toContain("Login times out");
    },
    TEST_TIMEOUT_MS * 2,
  );

  test(
    "a hand edit shows in AGENTS.md within the debounce, the file then stays put, and the next agent gets the new text",
    async () => {
      const service = await startService({ items: INSTRUCTIONS_FILES });
      const root = service.itemsRoot ?? "";
      const edit = (path: string, from: string, to: string) => writeFileSync(join(root, path), readFileSync(join(root, path), "utf8").replace(from, to));
      await untilFile(service, "the first render", (text) => text.includes("BL-1"));

      edit("backlog/BL-1-items.md", "The plan for structures and proposals.", "The plan for structures, proposals and reviews.");
      await untilFile(service, "an edited body", (text) => text.includes("proposals and reviews"));

      writeFileSync(join(root, "bugs/BUG-3-accents.md"), "---\nid: 0196f3c2-9b00-7000-8000-000000000003\nhandle: BUG-3\nrepo: api\n---\n# Search ignores accents\n\nInvented.\n");
      await untilFile(service, "a new item", (text) => text.includes("Search ignores accents"));

      rmSync(join(root, "docs/DOC-1-architecture.md"));
      await untilFile(service, "a deleted item gone", (text) => !text.includes("DOC-1"));

      edit("backlog/_structure.yaml", "instructions: full", "instructions: off");
      const settled = await untilFile(service, "a structure switched off", (text) => text.includes("BUG-1") && !text.includes("BL-1"));

      // No rewrite without a change (the watcher doesn't feed on its own writes).
      const written = statSync(service.instructionsPath).mtimeMs;
      await new Promise((resolve) => setTimeout(resolve, INSTRUCTIONS_DEBOUNCE_MS * 5));
      expect(statSync(service.instructionsPath).mtimeMs, "rewritten with nothing changed").toBe(written);

      const next = await startRecorded(service, PROMPTED);
      expect(promptText(next.sessionNew)).toBe(settled);
    },
    TEST_TIMEOUT_MS * 2,
  );

  test(
    "an agent's write and an approval show in AGENTS.md before the call answers, and the file is never inside a repo",
    async () => {
      const service = await startService({ items: INSTRUCTIONS_FILES });
      const { token } = await startRecorded(service, PROMPTED);

      // A write in an edit structure: read the file the moment the tool answers, well inside the debounce.
      const { version } = (await agentTool(service, token, "get_item", { handle: "BL-2" })) as { version: string };
      await agentTool(service, token, "update_item", { handle: "BL-2", fields: { body: "\nPlan it after the routes and the review.\n" }, version });
      expect(readInstructions(service), "after update_item answered").toContain("after the routes and the review");

      // A proposal changes nothing until it's approved; the approval shows before it answers.
      const bug = (await agentTool(service, token, "get_item", { handle: "BUG-2" })) as { version: string };
      const { proposed } = (await agentTool(service, token, "propose_update", {
        handle: "BUG-2",
        fields: { title: "The hero caption overlaps the image on small screens" },
        version: bug.version,
        reason: "Seen on a phone too.",
      })) as { proposed: string };
      expect(readInstructions(service), "after propose_update").not.toContain("on small screens");
      const approved = await service.api("POST", `/proposals/${proposed}/approve`);
      expect(approved.status, approved.text).toBe(200);
      expect(readInstructions(service), "after the approval answered").toContain("on small screens");

      expect(instructionFiles(service.workspace), "instruction files in the workspace").toEqual([join(".wombat", "AGENTS.md")]);
    },
    TEST_TIMEOUT_MS * 2,
  );

  test.each([
    { what: "without WOMBAT_ITEMS", items: undefined },
    { what: "with items but no structure marked as instructions", items: ACCESS_FILES },
  ])(
    "$what, a stale AGENTS.md is removed and agents get no system prompt",
    async ({ items }) => {
      const service = await startService({
        ...(items === undefined ? {} : { items }),
        workspaceFiles: { ".wombat/AGENTS.md": "# Old instructions\n\nstale-instructions-text\n" },
      });

      const prompted = await startRecorded(service, PROMPTED);
      expect(readInstructions(service), "the stale file").toBeUndefined();
      expect(Object.keys(prompted.sessionNew), "session/new keys").not.toContain("systemPrompt");
      expect(JSON.stringify(prompted.sessionNew)).not.toContain("stale-instructions-text");
    },
    TEST_TIMEOUT_MS * 2,
  );
});
