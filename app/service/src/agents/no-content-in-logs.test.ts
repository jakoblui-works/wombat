// Service logs hold ids, states and counts only: no prompt, reply, diff,
// tool content or agent stderr ever reaches a log line.
import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import {
  CONFIG_REFUSAL_MESSAGE,
  CONFIG_REFUSED_FILE,
  CONTEXT_FAILURE_MESSAGE,
  FAKE_BREAKDOWN,
  FAKE_CONFIG,
  HIDDEN_TITLE,
  HIDDEN_UPDATE_MARKER,
  RESUME_REFUSAL_MESSAGE,
  RESUME_REFUSED_FILE,
} from "../../test/fake-agent.ts";
import { chunkTexts, REPO, setup, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";

// Markers fixed by the fake scenarios' contract: the noisy scenario's stderr, and the text of the update the
// unknown-update scenario sends (it isn't stored, so it can't be read back from the entries).
const NOISY_STDERR_MARKER = "stderr-content-must-not-be-logged";
const SKIPPED_UPDATE_MARKER = "thought-content-must-not-be-logged";

/**
 * Every piece of agent or user content in the entries: texts, reasoning, plan entries, tool titles, diff paths and
 * texts, option names.
 */
const contentOf = (entries: LogEntry[]) =>
  entries.flatMap((entry): string[] => {
    switch (entry.type) {
      case "user_message":
        return [entry.text];
      case "permission_requested":
        return [entry.toolCall.title ?? "", ...entry.options.map((option) => option.name)];
      case "session_update": {
        const { update } = entry;
        if (update.sessionUpdate === "agent_thought_chunk") {
          return update.content.type === "text" ? [update.content.text] : [];
        }
        if (update.sessionUpdate === "plan") return update.entries.map((planEntry) => planEntry.content);
        if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
          return chunkTexts([entry]);
        }
        return [
          update.title ?? "",
          ...(update.content ?? []).flatMap((content) =>
            content.type === "diff"
              ? [content.path, content.oldText ?? "", content.newText]
              : content.content.type === "text"
                ? [content.content.text]
                : [],
          ),
        ];
      }
      default:
        return [];
    }
  });

describe("no agent content in logs", () => {
  test(
    "across reply, permission, crash, noisy stderr, plan and reasoning, and skipped updates, log lines carry ids and states, never content",
    async () => {
      const t = setup();
      const prompt = (label: string) => `${label} prompt ${randomUUID()}`;
      const ids: string[] = [];

      for (const scenario of ["reply", "noisy", "plan-thought", "unknown-update"] as const) {
        const { id } = await t.manager.start(`fake-${scenario}`, REPO);
        ids.push(id);
        await t.manager.send(id, { text: prompt(scenario) });
        await t.turnEnded(id);
      }

      const permission = await t.manager.start("fake-permission", REPO);
      ids.push(permission.id);
      await t.manager.send(permission.id, { text: prompt("permission") });
      await waitFor("a pending permission", () => t.agent(permission.id)?.state === "waiting");
      const request = t.entries(permission.id).find((entry) => entry.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      t.manager.answer(permission.id, request.requestId, "allow_once");
      await t.turnEnded(permission.id);

      const crash = await t.manager.start("fake-crash", REPO);
      ids.push(crash.id);
      await t.manager.send(crash.id, { text: prompt("crash") });
      await waitFor("the crash recorded", () => t.agent(crash.id)?.state === "error");

      const content = [...new Set([...ids.flatMap((id) => contentOf(t.entries(id))), NOISY_STDERR_MARKER, SKIPPED_UPDATE_MARKER])]
        .map((text) => text.trim())
        .filter((text) => text.length >= 4);
      expect(content.length).toBeGreaterThan(ids.length);

      // Control: the logs do talk about these agents, by id.
      const lines = t.logs.map((line) => JSON.stringify(line));
      expect(ids.every((id) => lines.some((line) => line.includes(id)))).toBe(true);

      for (const line of t.logs) {
        for (const value of Object.values(line.fields)) expect(["string", "number", "boolean"]).toContain(typeof value);
      }
      const leaks = lines.flatMap((line) => content.filter((text) => line.includes(text)).map((text) => ({ line, text })));
      expect(leaks).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // An agent's JSON-RPC error message is agent text: it goes back to the app in the error, never to a log line.
  test(
    "when the agent refuses a config option, its error message reaches the caller but no log line",
    async () => {
      const t = setup();
      const { id } = await t.manager.start("fake-reply", REPO);
      const refused = FAKE_CONFIG.model.values.find((value) => value.startsWith("refuse")) ?? "";
      const error = await t.manager.setConfig(id, FAKE_CONFIG.model.id, refused).then(
        () => undefined,
        (reason: unknown) => reason,
      );
      // Control: the refusal happened, and the message did come back, so the check below isn't vacuous.
      expect(error).toMatchObject({ code: "agent_error" });
      expect((error as Error).message).toContain(CONFIG_REFUSAL_MESSAGE);
      expect(t.logs.map((line) => JSON.stringify(line)).some((line) => line.includes(id))).toBe(true);

      const leaks = t.logs.map((line) => JSON.stringify(line)).filter((line) => line.includes(CONFIG_REFUSAL_MESSAGE));
      expect(leaks).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

// A hidden /context turn drops the agent's updates; dropping them must not log what they carry.
test(
  "a hidden /context turn's content never reaches a log line, also when the turn fails",
  async () => {
    const t = setup();
    const reply = await t.manager.start("fake-reply", REPO);
    expect(await t.manager.contextBreakdown(reply.id), "the hidden turn ran").toEqual(FAKE_BREAKDOWN);
    const failing = await t.manager.start("fake-prompt-error", REPO);
    await expect(t.manager.contextBreakdown(failing.id), "the failing hidden turn ran").rejects.toMatchObject({ code: "agent_error" });

    const lines = JSON.stringify(t.logs);
    for (const marker of [HIDDEN_UPDATE_MARKER, HIDDEN_TITLE, CONTEXT_FAILURE_MESSAGE]) expect(lines).not.toContain(marker);
  },
  TEST_TIMEOUT_MS,
);

// The resume's own log lines (agent_resuming, agent_resumed, agent_resume_failed,
// config_restore_refused) carry ids and codes; the agent's refusals and the messages that caused them stay out.
test(
  "a refused resume and a resume whose restore the agent refuses log ids and codes, never the prompts, replies or the agent's messages",
  async () => {
    const t = setup();
    const folder = join(t.root, REPO);
    const prompts = [`refused prompt ${randomUUID()}`, `resumed prompt ${randomUUID()}`];
    const { id } = await t.manager.start("fake-reply", REPO);
    await t.manager.setConfig(id, FAKE_CONFIG.effort.id, "high");
    await t.manager.stop(id);

    writeFileSync(join(folder, RESUME_REFUSED_FILE), "");
    await t.manager.send(id, { text: prompts[0] ?? "" });
    await t.turnEnded(id, 1);
    rmSync(join(folder, RESUME_REFUSED_FILE));
    writeFileSync(join(folder, CONFIG_REFUSED_FILE), "");
    await t.manager.send(id, { text: prompts[1] ?? "" });
    const ended = await t.turnEnded(id, 2);

    // Controls: the resume went on past the refused restore, and both failures were logged about this agent.
    expect(ended.stopReason).toBe("end_turn");
    const lines = t.logs.map((line) => JSON.stringify(line));
    for (const event of ["agent_resume_failed", "config_restore_refused"]) {
      expect(t.logs.some((line) => line.event === event && JSON.stringify(line).includes(id)), `${event}, by id`).toBe(true);
    }
    for (const line of t.logs) {
      for (const value of Object.values(line.fields)) expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    const content = [...prompts, ...chunkTexts(t.entries(id)), RESUME_REFUSAL_MESSAGE, CONFIG_REFUSAL_MESSAGE];
    expect(chunkTexts(t.entries(id)).length, "control: the reply is there to look for").toBeGreaterThan(0);
    const leaks = lines.flatMap((line) => content.filter((text) => line.includes(text)).map((text) => ({ line, text })));
    expect(leaks).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);
