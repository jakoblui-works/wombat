// Lasting check (silent failure): service logs hold ids, states and counts only: no prompt, reply, diff,
// tool content or agent stderr ever reaches a log line.
import { randomUUID } from "node:crypto";

import type { Item } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { chunkTexts, REPO, setup, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";

// Markers fixed by the fake scenarios' contract: the noisy scenario's stderr, and the text of the update the
// unknown-update scenario sends (it isn't stored, so it can't be read back from the items).
const NOISY_STDERR_MARKER = "stderr-content-must-not-be-logged";
const SKIPPED_UPDATE_MARKER = "thought-content-must-not-be-logged";

/** Every piece of agent or user content in the items: texts, tool titles, diff paths and texts, option names. */
const contentOf = (items: Item[]) =>
  items.flatMap((item): string[] => {
    switch (item.type) {
      case "user_message":
        return [item.text];
      case "permission_requested":
        return [item.toolCall.title ?? "", ...item.options.map((option) => option.name)];
      case "session_update": {
        const { update } = item;
        if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
          return chunkTexts([item]);
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
    "across reply, permission, crash, noisy stderr and skipped updates, log lines carry ids and states, never content",
    async () => {
      const t = setup();
      const prompt = (label: string) => `${label} prompt ${randomUUID()}`;
      const ids: string[] = [];

      for (const scenario of ["reply", "noisy", "unknown-update"] as const) {
        const { id } = await t.manager.start(`fake-${scenario}`, REPO);
        ids.push(id);
        await t.manager.send(id, { text: prompt(scenario) });
        await t.turnEnded(id);
      }

      const permission = await t.manager.start("fake-permission", REPO);
      ids.push(permission.id);
      await t.manager.send(permission.id, { text: prompt("permission") });
      await waitFor("a pending permission", () => t.agent(permission.id)?.state === "waiting");
      const request = t.items(permission.id).find((item) => item.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      t.manager.answer(permission.id, request.requestId, "allow_once");
      await t.turnEnded(permission.id);

      const crash = await t.manager.start("fake-crash", REPO);
      ids.push(crash.id);
      await t.manager.send(crash.id, { text: prompt("crash") });
      await waitFor("the crash recorded", () => t.agent(crash.id)?.state === "error");

      const content = [...new Set([...ids.flatMap((id) => contentOf(t.items(id))), NOISY_STDERR_MARKER, SKIPPED_UPDATE_MARKER])]
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
});
