// Lasting check "Chat model is append-order-free" (T8): the chat shows the same thing however the log reached the
// cache: in one read, in appends split anywhere, out of order, or with entries delivered twice (a reconnect re-reads
// from a cursor and may overlap what an alert already brought). And an item's key never changes as more of the log
// arrives, so React keeps each item's identity.
import fc from "fast-check";
import { expect, test } from "vitest";

import type { LogEntry } from "@wombat/shared/api";
import {
  type Body,
  chunk,
  diffContent,
  entries,
  inSession,
  permissionAnswered,
  permissionRequested,
  plan,
  textContent,
  thought,
  toolCall,
  toolUpdate,
  turnEnded,
  UNSHOWN,
  user,
} from "../../../../test/log-entries.ts";
import { chatModel } from "./chat-model.ts";

// Realistic logs: turns of user messages, chunk runs (with and without a messageId, from the main session or a
// sub-agent's), tool calls with updates that may land later (or one before its call), orphan updates, permission
// requests answered later, never, or after a cancel, plan updates, thoughts, and entries the chat doesn't show.

const text = fc.constantFrom("Hel", "lo", " ", "the opening hours", "\n", "Juniper Lane", "");
const messageId = fc.constantFrom<string | null | undefined>(undefined, null, "msg-1", "msg-2");
const OPTION_KINDS = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;
const permissionKind = fc.constantFrom(...OPTION_KINDS);

type UpdateFields = Parameters<typeof toolUpdate>[1];
const updateFields: fc.Arbitrary<UpdateFields> = fc.record(
  {
    status: fc.constantFrom("in_progress", "completed", "failed" as const),
    title: fc.constantFrom("Edit notes.txt", "Run the tests"),
    content: fc.constantFrom([textContent("3 passed")], [diffContent("notes.txt", "Mon closed", "Mon 9-17")], []),
    locations: fc.constantFrom([{ path: "notes.txt" }], [{ path: "hours.md", line: 4 }]),
    rawOutput: fc.constantFrom({ exitCode: 0 }, "done"),
  },
  { requiredKeys: [] },
);

type Event =
  | { k: "user"; text: string }
  | { k: "chunks"; thought: boolean; messageId: string | null | undefined; session: string | undefined; texts: string[] }
  | { k: "tool"; title: string; updates: { delay: number; fields: UpdateFields }[]; updateFirst: boolean }
  | { k: "orphan"; fields: UpdateFields }
  | { k: "permission"; onTool: boolean; title: string | undefined; answer: { kind: (typeof OPTION_KINDS)[number]; delay: number } | null }
  | { k: "plan"; contents: string[] }
  | { k: "unshown"; index: number }
  | { k: "end"; reason: string };

const event: fc.Arbitrary<Event> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ k: fc.constant("user" as const), text }) },
  {
    weight: 4,
    arbitrary: fc.record({
      k: fc.constant("chunks" as const),
      thought: fc.boolean(),
      messageId,
      // The main session (with or without its id stored) or a sub-agent's.
      session: fc.constantFrom(undefined, "session-main", "session-sub"),
      texts: fc.array(text, { minLength: 1, maxLength: 4 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      k: fc.constant("tool" as const),
      title: fc.constantFrom("Read hours.md", "Edit notes.txt"),
      updates: fc.array(fc.record({ delay: fc.nat({ max: 4 }), fields: updateFields }), { maxLength: 3 }),
      updateFirst: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("orphan" as const), fields: updateFields }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant("permission" as const),
      onTool: fc.boolean(),
      title: fc.option(fc.constantFrom("Edit notes.txt", "Run npm test"), { nil: undefined }),
      answer: fc.option(fc.record({ kind: permissionKind, delay: fc.nat({ max: 5 }) }), { nil: null }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("plan" as const), contents: fc.array(fc.constantFrom("Read", "Edit", "Test"), { maxLength: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("unshown" as const), index: fc.nat({ max: UNSHOWN.length - 1 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("end" as const), reason: fc.constantFrom("end_turn", "cancelled") }) },
);

/** Lays the events out as a log: pieces that come later (tool updates, answers) land `delay` events on. */
const toLog = (events: Event[]): LogEntry[] => {
  const placed: { at: number; body: Body }[] = [];
  const put = (at: number, body: Body) => placed.push({ at, body });
  let lastTool: string | undefined;
  events.forEach((ev, i) => {
    switch (ev.k) {
      case "user":
        put(i, user(ev.text || "Fix the hours"));
        break;
      case "chunks":
        for (const piece of ev.texts) {
          const body = (ev.thought ? thought : chunk)(piece, ev.messageId);
          put(i, ev.session === undefined ? body : inSession(body, ev.session));
        }
        break;
      case "tool": {
        const id = `tool-${String(i)}`;
        const [first, ...rest] = ev.updates;
        if (ev.updateFirst && first) put(i, toolUpdate(id, first.fields));
        put(i, toolCall(id, ev.title, { kind: "edit", status: "pending", rawInput: { path: "notes.txt" } }));
        for (const { delay, fields } of ev.updateFirst ? rest : ev.updates) put(i + delay + 0.5, toolUpdate(id, fields));
        lastTool = id;
        break;
      }
      case "orphan":
        put(i, toolUpdate(`orphan-${String(i)}`, ev.fields));
        break;
      case "permission": {
        const requestId = `req-${String(i)}`;
        const toolCallId = ev.onTool && lastTool !== undefined ? lastTool : `tool-p${String(i)}`;
        put(i, permissionRequested(requestId, { toolCallId, ...(ev.title === undefined ? {} : { title: ev.title }) }));
        if (ev.answer) put(i + ev.answer.delay + 0.5, permissionAnswered(requestId, ev.answer.kind));
        break;
      }
      case "plan":
        put(i, plan(...ev.contents));
        break;
      case "unshown":
        put(i, UNSHOWN[ev.index] as Body);
        break;
      case "end":
        put(i, turnEnded(ev.reason));
        break;
    }
  });
  // Array.prototype.sort is stable: pieces of one event keep their order.
  return entries(placed.sort((a, b) => a.at - b.at).map(({ body }) => body));
};

const log = fc.array(event, { maxLength: 25 }).map(toLog);

/** The log as appends: cut anywhere, each append re-delivering up to a few entries before its cut (an overlap). */
const appendsOf = (all: LogEntry[]) =>
  fc
    .array(fc.record({ cut: fc.nat({ max: all.length }), overlap: fc.nat({ max: 3 }) }), { maxLength: 6 })
    .map((cuts) => {
      const sorted = [...cuts].sort((a, b) => a.cut - b.cut);
      const bounds = [...sorted, { cut: all.length, overlap: 0 }];
      const out: LogEntry[] = [];
      let from = 0;
      for (const { cut, overlap } of bounds) {
        out.push(...structuredClone(all.slice(Math.max(0, from - overlap), cut)));
        from = Math.max(from, cut);
      }
      return out;
    });

/** The log's entries in any order, some of them twice. */
const shuffledWithDuplicates = (all: LogEntry[]) =>
  fc
    .array(fc.nat({ max: Math.max(0, all.length - 1) }), { maxLength: all.length === 0 ? 0 : 8 })
    .chain((again) => {
      const delivered = [...all, ...again.map((i) => all[i] as LogEntry)].map((entry) => structuredClone(entry));
      return fc.shuffledSubarray(delivered, { minLength: delivered.length, maxLength: delivered.length });
    });

test("the chat model of a log is the same however the log arrived: split into appends, overlapping, out of order or twice", () => {
  fc.assert(
    fc.property(
      log.chain((all) => fc.tuple(fc.constant(all), appendsOf(all), shuffledWithDuplicates(all))),
      ([all, appended, shuffled]) => {
        const once = chatModel(all);
        expect(chatModel(appended)).toEqual(once);
        expect(chatModel(shuffled)).toEqual(once);
      },
    ),
  );
});

test("item keys are unique, and an item keeps its key and kind as more of the log arrives", () => {
  fc.assert(
    fc.property(log, (all) => {
      const full = chatModel(all).items;
      const keys = full.map((item) => item.key);
      expect(new Set(keys).size, `duplicate keys: ${keys.join(", ")}`).toBe(keys.length);
      const kindByKey = new Map(full.map((item) => [item.key, item.kind]));
      for (let length = 0; length < all.length; length++) {
        for (const item of chatModel(all.slice(0, length)).items) {
          expect(kindByKey.get(item.key), `item ${item.key} (${item.kind}) after ${String(length)} entries`).toBe(item.kind);
        }
      }
    }),
  );
});
