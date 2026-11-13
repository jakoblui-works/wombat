// Lasting checks (silent failures and the instructions-file contract) through the service as a process: an
// agent started as soon as the service is up gets exactly `<workspace>/.wombat/AGENTS.md` as the top-level
// `systemPrompt` (mode append) of its session/new, and a harness that doesn't ask gets nothing; a hand edit shows
// in the file within the debounce (a change that leaves its text as it is doesn't rewrite it), and an approval
// before it answers; the file never lands in a repo; and with nothing to render, a stale file is removed and no
// prompt is sent.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { INSTRUCTIONS_DEBOUNCE_MS } from "./instructions.ts";
import { ACCESS_FILES } from "../../test/access-fixtures.ts";
import { INSTRUCTIONS_FILES } from "../../test/instructions-fixtures.ts";
import { TEST_TIMEOUT_MS } from "../../test/manager-fixtures.ts";
import {
  PLAIN,
  PROMPTED,
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

/** The service's writes of the instructions file, from its log: each one's size in bytes. */
const writes = (service: RunningService) =>
  service
    .stderr()
    .split("\n")
    .filter((line) => line.includes('"event":"instructions_written"'))
    .map((line) => (JSON.parse(line) as { bytes: number }).bytes);

/** Waits until the service has logged the write of `text`, the file's current text, and answers how many writes it logged. */
const untilLogged = async (service: RunningService, text: string) => {
  await expect.poll(() => writes(service).at(-1), { message: "the write of the current file in the log" }).toBe(Buffer.byteLength(text));
  return writes(service).length;
};

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

      // A harness without the hook: the same session/new, without anything it didn't ask for.
      const plain = await startRecorded(service, PLAIN);
      expect(Object.keys(plain.sessionNew).sort()).toEqual(Object.keys(prompted.sessionNew).filter((key) => key !== "systemPrompt").sort());
      expect(JSON.stringify(plain.sessionNew)).not.toContain("Login times out");
    },
    TEST_TIMEOUT_MS * 2,
  );

  test(
    "a hand edit shows in AGENTS.md within the debounce, a change that leaves its text as it is doesn't rewrite it, and the next agent gets the new text",
    async () => {
      const service = await startService({ items: INSTRUCTIONS_FILES });
      const root = service.itemsRoot ?? "";
      const edit = (path: string, from: string, to: string) => writeFileSync(join(root, path), readFileSync(join(root, path), "utf8").replace(from, to));
      await untilFile(service, "the first write", (text) => text.includes("BL-1"));

      edit("backlog/BL-1-items.md", "The plan for structures and proposals.", "The plan for structures, proposals and reviews.");
      await untilFile(service, "an edited body", (text) => text.includes("proposals and reviews"));

      writeFileSync(join(root, "bugs/BUG-3-accents.md"), "---\nid: 0196f3c2-9b00-7000-8000-000000000003\nhandle: BUG-3\nrepo: api\n---\n# Search ignores accents\n\nInvented.\n");
      await untilFile(service, "a new item", (text) => text.includes("Search ignores accents"));

      rmSync(join(root, "docs/DOC-1-architecture.md"));
      await untilFile(service, "a deleted item gone", (text) => !text.includes("DOC-1"));

      edit("backlog/_structure.yaml", "instructions: full", "instructions: off");
      const settled = await untilFile(service, "a structure switched off", (text) => text.includes("BUG-1") && !text.includes("BL-1"));

      // No rewrite without a change (the watcher doesn't feed on its own writes): a hand-made file in the
      // switched-off structure makes a read of the root, which gives the file an id on first sight, but renders the
      // same text, so it doesn't write; the visible edit after that read writes once.
      const before = await untilLogged(service, settled);
      const offFile = join(root, "backlog/a-note-while-off.md");
      writeFileSync(offFile, "# A note while the backlog is off\n\nInvented.\n");
      await expect.poll(() => readFileSync(offFile, "utf8"), { message: "the id first sight gives", timeout: INSTRUCTIONS_DEBOUNCE_MS + SETTLE_MS }).toMatch(/^id: /m);
      edit("bugs/BUG-3-accents.md", "# Search ignores accents", "# Search ignores accents and case");
      const current = await untilFile(service, "an edited title", (text) => text.includes("ignores accents and case"));
      expect(current.replace("ignores accents and case", "ignores accents"), "the switched-off file changed nothing").toBe(settled);
      expect(await untilLogged(service, current), "writes since the file settled").toBe(before + 1);

      const next = await startRecorded(service, PROMPTED);
      expect(promptText(next.sessionNew)).toBe(current);
    },
    TEST_TIMEOUT_MS * 2,
  );

  test.each([
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
