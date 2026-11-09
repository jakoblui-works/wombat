// Lasting check (silent failure): alerts never carry agent content. Read off the raw stream, before parseAlert
// strips unknown fields: every alert has only seq, dbId, type and agentId, and no prompt, reply, tool title,
// diff, option name or image data appears anywhere on the stream.
import { randomUUID } from "node:crypto";

import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, TEST_TIMEOUT_MS, waitFor } from "../../test/manager-fixtures.ts";
import { serve } from "../../test/server-fixtures.ts";

// The text of the update the unknown-update scenario sends; it isn't stored, so it can't be read from the entries.
const SKIPPED_UPDATE_MARKER = "thought-content-must-not-be-logged";

const contentBlock = (block: { type: string; text?: string; data?: string }) =>
  block.type === "text" ? [block.text ?? ""] : block.type === "image" ? [block.data ?? ""] : [];

/** Every piece of agent or user content in the entries. */
const contentOf = (entries: LogEntry[]) =>
  entries.flatMap((entry): string[] => {
    switch (entry.type) {
      case "user_message":
        return [entry.text];
      case "permission_requested":
        return [entry.toolCall.title ?? "", ...entry.options.map((option) => option.name)];
      case "session_update": {
        const { update } = entry;
        if (update.sessionUpdate === "agent_message_chunk") return contentBlock(update.content);
        if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return [];
        return [
          update.title ?? "",
          ...(update.content ?? []).flatMap((content) =>
            content.type === "diff"
              ? [content.path, content.oldText ?? "", content.newText]
              : contentBlock(content.content),
          ),
        ];
      }
      default:
        return [];
    }
  });

describe("no agent content in alerts", () => {
  test(
    "across reply, image, skipped updates, permission and crash, the stream carries ids, seqs and types only",
    async () => {
      const s = await serve();
      const stream = await s.stream();
      expect(stream.status).toBe(200);
      const ids: string[] = [];
      const start = async (scenario: string) => {
        const response = await s.api("POST", "/agents", { harness: `fake-${scenario}`, repo: REPO });
        const { id } = response.json as { id: string };
        ids.push(id);
        const sent = await s.api("POST", `/agents/${id}/messages`, { text: `${scenario} prompt ${randomUUID()}` });
        expect(sent.status, sent.text).toBe(202);
        return id;
      };

      for (const scenario of ["reply", "image", "unknown-update"]) await s.turnEnded(await start(scenario));

      const permission = await start("permission");
      await waitFor("a pending permission", () => s.agent(permission)?.state === "waiting");
      const request = s.entries(permission).find((entry) => entry.type === "permission_requested");
      if (request?.type !== "permission_requested") throw new Error("no permission request");
      const answered = await s.api("POST", `/agents/${permission}/permissions/${request.requestId}`, { kind: "allow_once" });
      expect(answered.status).toBe(204);
      await s.turnEnded(permission);

      const crash = await start("crash");
      await waitFor("the crash recorded", () => s.agent(crash)?.state === "error");

      const last = String(s.store.currentSeq());
      await stream.until("the stream to catch up with the store", (open) => open.events().some((event) => event.id === last));

      const alerts = stream.events().filter((event) => event.data !== "");
      // Control: the stream did announce these agents.
      expect(ids.every((id) => alerts.some((event) => event.data.includes(id)))).toBe(true);
      for (const event of alerts) {
        expect(Object.keys(JSON.parse(event.data) as object).sort(), event.data).toEqual(["agentId", "dbId", "seq", "type"]);
      }

      const content = [...new Set([...ids.flatMap((id) => contentOf(s.entries(id))), SKIPPED_UPDATE_MARKER])]
        .map((text) => text.trim())
        .filter((text) => text.length >= 4);
      expect(content.length).toBeGreaterThan(ids.length);
      const raw = stream.raw();
      expect(content.filter((text) => raw.includes(text))).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
