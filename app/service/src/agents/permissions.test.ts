// Agent manager: permission requests answered by kind, their errors, and cancel while one is pending.
import type { Item } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import { REPO, setup, TEST_TIMEOUT_MS, thrown, waitFor, type Setup } from "../../test/manager-fixtures.ts";

type Requested = Extract<Item, { type: "permission_requested" }>;

/** Starts the permission scenario and waits until its request is pending. */
const pendingRequest = async (t: Setup) => {
  const { id } = await t.manager.start("fake-permission", REPO);
  await t.manager.send(id, { text: "Edit the notes" });
  await waitFor("state waiting", () => t.agent(id)?.state === "waiting");
  const request = t.items(id).find((item): item is Requested => item.type === "permission_requested");
  if (!request) throw new Error("no permission_requested item while waiting");
  return { id, request };
};

const after = (items: Item[], seq: number) => items.filter((item) => item.seq > seq);

describe("permissions", () => {
  test.each([
    { kind: "allow_once" as const, status: "completed" },
    { kind: "reject_once" as const, status: "failed" },
  ])(
    "answering $kind sends that option: permission_answered, then the tool call is $status, and the turn ends",
    async ({ kind, status }) => {
      const t = setup();
      const { id, request } = await pendingRequest(t);

      const toolCall = t.items(id).find(
        (item) => item.type === "session_update" && item.update.sessionUpdate === "tool_call",
      );
      expect(toolCall).toMatchObject({
        update: { kind: "edit", content: [expect.objectContaining({ type: "diff", newText: expect.any(String) as unknown })] },
      });
      expect(toolCall && toolCall.seq < request.seq).toBe(true);
      expect(request.requestId).not.toBe("");
      expect(request.options.map((option) => option.kind)).toEqual(expect.arrayContaining(["allow_once", "reject_once"]));

      t.manager.answer(id, request.requestId, kind);
      expect((await t.turnEnded(id)).stopReason).toBe("end_turn");
      await waitFor("state done", () => t.agent(id)?.state === "done");

      const later = after(t.items(id), request.seq);
      expect(later[0]).toMatchObject({ type: "permission_answered", requestId: request.requestId, kind });
      expect(later).toContainEqual(
        expect.objectContaining({ update: expect.objectContaining({ sessionUpdate: "tool_call_update", status }) as unknown }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "answer errors: unknown agent or request and an answered one are not_found, a kind not offered is kind_not_offered; none reaches the agent",
    async () => {
      const t = setup();
      const { id, request } = await pendingRequest(t);

      expect(thrown(() => t.manager.answer("no-such-agent", request.requestId, "allow_once"))).toMatchObject({
        code: "not_found",
      });
      expect(thrown(() => t.manager.answer(id, "no-such-request", "allow_once"))).toMatchObject({ code: "not_found" });
      expect(thrown(() => t.manager.answer(id, request.requestId, "allow_always"))).toMatchObject({
        code: "kind_not_offered",
      });
      expect(t.agent(id)?.state).toBe("waiting");
      expect(t.items(id).filter((item) => item.type === "permission_answered")).toEqual([]);

      t.manager.answer(id, request.requestId, "reject_once");
      expect(thrown(() => t.manager.answer(id, request.requestId, "allow_once"))).toMatchObject({ code: "not_found" });
      await t.turnEnded(id);
      expect(t.items(id).filter((item) => item.type === "permission_answered")).toHaveLength(1);
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
      expect(t.items(id).filter((item) => item.type === "permission_answered")).toEqual([]);
      expect(thrown(() => t.manager.answer(id, request.requestId, "allow_once"))).toMatchObject({ code: "not_found" });
    },
    TEST_TIMEOUT_MS,
  );
});
