// S7 T14 (silent failure): the chat's edit card and the diff tab show the same request. `editRequest` reads it from
// the chat model: every diff of the request's own tool call (by toolCallId, not whichever edit came last), in order,
// and the answer the chat's item has. An edit stays an edit: when a tool_call_update replaces the diffs (several
// diffs, or text only after the answer), the request still reads as an edit of its file, with the diffs it holds now
// (none for text) and its outcome intact. A request whose tool call holds no diff and isn't an "edit" with a
// location, or an unknown id, is no edit.
import { expect, test } from "vitest";

import {
  diffContent,
  entries,
  permissionAnswered,
  permissionRequested,
  textContent,
  toolCall,
  toolUpdate,
  user,
} from "../../../../../../../shared/test/log-entries.ts";
import { chatModel } from "../../../data/chat-model.ts";
import { editRequest } from "./edit-request.ts";

const HOURS = "/ws/bakery-site/hours.md";

const model = (answered: boolean) =>
  chatModel(
    entries([
      user("Update the opening hours and the menu"),
      toolCall("tool-hours", "Edit hours.md", { kind: "edit", status: "pending", content: [diffContent(HOURS, "Mon 8-16\n", "Mon 7-15\n")] }),
      toolCall("tool-menu", "Edit menu.md", { kind: "edit", status: "pending", content: [diffContent("/ws/bakery-site/menu.md", null, "# Menu\n")] }),
      toolCall("tool-test", "Run the tests", { kind: "execute", status: "pending" }),
      permissionRequested("req-hours", { toolCallId: "tool-hours" }),
      permissionRequested("req-menu", { toolCallId: "tool-menu" }),
      permissionRequested("req-test", { toolCallId: "tool-test" }),
      ...(answered ? [permissionAnswered("req-hours", "allow_once")] : []),
    ]),
  );

type Model = ReturnType<typeof chatModel>;

const chatAnswer = (m: Model, requestId: string) => {
  const item = m.items.find((candidate) => candidate.kind === "permission" && candidate.requestId === requestId);
  expect(item?.kind, `no chat item for ${requestId}`).toBe("permission");
  return item?.kind === "permission" ? item.answer : "no chat item";
};

test("each request gets its own tool call's diffs and the chat's answer for it", () => {
  for (const answered of [false, true]) {
    const m = model(answered);
    const hours = editRequest(m, "req-hours");
    const menu = editRequest(m, "req-menu");

    expect(hours).toMatchObject({ requestId: "req-hours", path: HOURS, diffs: [{ oldText: "Mon 8-16\n", newText: "Mon 7-15\n" }] });
    expect(menu).toMatchObject({ requestId: "req-menu", path: "/ws/bakery-site/menu.md" });
    expect(menu?.diffs).toHaveLength(1);
    expect(menu?.diffs[0]?.newText).toBe("# Menu\n");
    expect(menu?.diffs[0]?.oldText ?? null).toBeNull();

    expect(hours?.answer).toBe(chatAnswer(m, "req-hours"));
    expect(menu?.answer).toBe(chatAnswer(m, "req-menu"));
    expect(hours?.answer).toBe(answered ? "allow_once" : undefined);
  }
});

test("an edit stays an edit when its content is replaced: several diffs all in order, or text with no diff left", () => {
  const replaced = (content: Parameters<typeof toolUpdate>[1]) =>
    chatModel(
      entries([
        user("Update the opening hours"),
        toolCall("tool-hours", "Edit hours.md", { kind: "edit", status: "pending", locations: [{ path: HOURS }], content: [diffContent(HOURS, "Mon 8-16\n", "Mon 7-15\n")] }),
        permissionRequested("req-hours", { toolCallId: "tool-hours" }),
        permissionAnswered("req-hours", "allow_once"),
        toolUpdate("tool-hours", { status: "completed", ...content }),
      ]),
    );

  const several = replaced({
    content: [
      diffContent(HOURS, "Mon 8-16\n", "Mon 7-15\n"),
      diffContent(HOURS, "Tue 8-16\n", "Tue 7-15\n"),
      diffContent(HOURS, "Sun closed\n", "Sun 9-12\n"),
    ],
  });
  const many = editRequest(several, "req-hours");
  expect(many).toMatchObject({ requestId: "req-hours", path: HOURS, answer: "allow_once" });
  expect(many?.diffs.map(({ oldText, newText }) => [oldText, newText])).toEqual([
    ["Mon 8-16\n", "Mon 7-15\n"],
    ["Tue 8-16\n", "Tue 7-15\n"],
    ["Sun closed\n", "Sun 9-12\n"],
  ]);

  const textOnly = replaced({ content: [textContent("Wrote 1,204 lines to hours.md")] });
  const text = editRequest(textOnly, "req-hours");
  expect(text, "a replaced edit stopped being an edit").toBeDefined();
  expect(text).toMatchObject({ requestId: "req-hours", path: HOURS, diffs: [] });
  expect(text?.answer).toBe("allow_once");
  expect(text?.answer).toBe(chatAnswer(textOnly, "req-hours"));
});

test("no edit: no diff and not an edit with a location, or an unknown request", () => {
  const m = model(false);
  expect(editRequest(m, "req-test")).toBeUndefined();
  expect(editRequest(m, "req-never-asked")).toBeUndefined();

  const others = chatModel(
    entries([
      user("Look around"),
      // A command with a location: not an edit.
      toolCall("tool-run", "Run the build", { kind: "execute", locations: [{ path: HOURS }], content: [textContent("ok")] }),
      // An edit naming no file and holding no diff: nothing to show.
      toolCall("tool-blind", "Edit something", { kind: "edit", content: [textContent("done")] }),
      permissionRequested("req-run", { toolCallId: "tool-run" }),
      permissionRequested("req-blind", { toolCallId: "tool-blind" }),
    ]),
  );
  expect(editRequest(others, "req-run")).toBeUndefined();
  expect(editRequest(others, "req-blind")).toBeUndefined();
});
