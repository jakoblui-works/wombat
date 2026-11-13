// Agent manager: permission requests answered by kind, their errors, and cancel while one is pending.
import type { LogEntry } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, setup, TEST_TIMEOUT_MS, thrown, waitFor, type Setup } from "../../test/manager-fixtures.ts";

type Requested = Extract<LogEntry, { type: "permission_requested" }>;

/** Starts the permission scenario and waits until its request is pending. */
const pendingRequest = async (t: Setup) => {
  const { id } = await t.manager.start("fake-permission", REPO);
  await t.manager.send(id, { text: "Edit the notes" });
  await waitFor("state waiting", () => t.agent(id)?.state === "waiting");
  const request = t.entries(id).find((entry): entry is Requested => entry.type === "permission_requested");
  if (!request) throw new Error("no permission_requested entry while waiting");
  return { id, request };
};

const after = (entries: LogEntry[], seq: number) => entries.filter((entry) => entry.seq > seq);

describe("permissions", () => {
  test.each([
    { kind: "reject_once" as const, status: "failed" },
  ])(
    "answering $kind sends that option: permission_answered, then the tool call is $status, and the turn ends",
    async ({ kind, status }) => {
      const t = setup();
      const { id, request } = await pendingRequest(t);

      t.manager.answer(id, request.requestId, kind);
      expect((await t.turnEnded(id)).stopReason).toBe("end_turn");
      await waitFor("state done", () => t.agent(id)?.state === "done");

      const later = after(t.entries(id), request.seq);
      expect(later[0]).toMatchObject({ type: "permission_answered", requestId: request.requestId, kind });
      expect(later).toContainEqual(
        expect.objectContaining({ update: expect.objectContaining({ sessionUpdate: "tool_call_update", status }) as unknown }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "cancel while waiting for permission: the turn ends cancelled, state done, and the request can't be answered any more",
    async () => {
      const t = setup();
      const { id, request } = await pendingRequest(t);

      await t.manager.cancel(id);
      expect((await t.turnEnded(id)).stopReason).toBe("cancelled");
      await waitFor("state done", () => t.agent(id)?.state === "done");
      expect(t.entries(id).filter((entry) => entry.type === "permission_answered")).toEqual([]);
      expect(t.agent(id)?.pendingPermissions).toEqual([]);
      expect(thrown(() => t.manager.answer(id, request.requestId, "allow_once"))).toMatchObject({ code: "not_found" });
    },
    TEST_TIMEOUT_MS,
  );
});
