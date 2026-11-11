// What an agent's summary keeps besides its state: the excerpt of its latest message (lastText), its folder's branch,
// and when the user last interacted (lastUserAt).
import { join } from "node:path";

import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { git, gitRepo, REPO, setup, TEST_TIMEOUT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";

const entryOf = <T extends LogEntry["type"]>(t: Setup, id: string, type: T) => {
  const entry = t
    .entries(id)
    .findLast((candidate): candidate is Extract<LogEntry, { type: T }> => candidate.type === type);
  if (!entry) throw new Error(`no ${type} entry`);
  return entry;
};

/** Waits until the clock has moved past `at`, so a timestamp written now would differ from it. */
const after = (at: string) => waitFor("the clock to move on", () => Date.now() > Date.parse(at));

describe("lastText", () => {
  test.each([
    {
      scenario: "message-ids",
      how: "chunks of one messageId join, and a new messageId replaces the message",
      lastText: "The second message replaces the first.",
    },
    {
      scenario: "message-runs",
      how: "without messageIds, the run of chunks since the last other update",
      lastText: "After the tool call.",
    },
  ])(
    "$how",
    async ({ scenario, lastText }) => {
      const t = setup();
      const { id } = await t.manager.start(`fake-${scenario}`, REPO);
      await t.manager.send(id, { text: "Say two things" });
      await t.turnEnded(id);

      await waitFor("state done", () => t.agent(id)?.state === "done");
      expect(t.agent(id)?.lastText).toBe(lastText);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("branch", () => {
  test(
    "is the repo's branch at start, and the new one after a turn when it was switched in between",
    async () => {
      const t = setup();
      const repo = join(t.root, REPO);
      gitRepo(repo, "main");

      const started = await t.manager.start("fake-reply", REPO);
      expect(started.branch).toBe("main");

      git(repo, "switch", "--quiet", "--create", "feature/footer-imprint");
      await t.manager.send(started.id, { text: "Hello" });
      await t.turnEnded(started.id);

      await waitFor("the branch refreshed", () => t.agent(started.id)?.branch === "feature/footer-imprint");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "is absent for an agent whose folder isn't in a git repo",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-reply", REPO);
      await t.manager.send(id, { text: "Hello" });
      await t.turnEnded(id);

      await waitFor("state done", () => t.agent(id)?.state === "done");
      expect(t.agent(id)).not.toHaveProperty("branch");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("lastUserAt", () => {
  test(
    "is set when a message and a permission answer are accepted, and not by a repeated commandId",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-permission", REPO);
      expect(t.agent(id)).not.toHaveProperty("lastUserAt");

      await t.manager.send(id, { text: "Edit the notes", commandId: "cmd_1" });
      await waitFor("state waiting", () => t.agent(id)?.state === "waiting");
      const message = entryOf(t, id, "user_message");
      expect(t.agent(id)?.lastUserAt).toBe(message.at);

      await after(message.at);
      t.manager.answer(id, entryOf(t, id, "permission_requested").requestId, "allow_once");
      const answered = entryOf(t, id, "permission_answered");
      expect(answered.at).not.toBe(message.at);
      expect(t.agent(id)?.lastUserAt).toBe(answered.at);
      await t.turnEnded(id);

      await after(answered.at);
      await t.manager.send(id, { text: "Edit the notes", commandId: "cmd_1" });
      expect(t.agent(id)?.lastUserAt).toBe(answered.at);
    },
    TEST_TIMEOUT_MS,
  );
});
