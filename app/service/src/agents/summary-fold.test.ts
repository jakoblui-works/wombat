// The row and the chat agree: for any log an agent writes, the agents list and Needs me show what the chat shows. The
// chat folds the whole stored log with plain concatenation; the service folds one turn at a time and keeps of each text
// only what an excerpt needs. After every stored entry the row's activity is the chat's; at each request and each
// turn's end (where the service writes the summary) lastText is the excerpt of the chat's latest main-session message,
// and a request's title and kind are the chat's.
//
// Tool updates and requests name tool calls of their own turn or none: the service's fold restarts per turn, so an
// update naming an earlier turn's tool would have no title on the service's side while the chat's fold has one.
import type { AgentSummary, LogEntry } from "@wombat/shared/api";
import { activityOf, emptyFold, foldLog, lastMainMessage, permissionOf } from "@wombat/shared/log-fold";
import fc from "fast-check";
import { expect, test } from "vitest";

import { type Body, chunk, entries, inSession, permissionRequested, plan, thought, toolCall, toolUpdate, turnEnded, user } from "../../../shared/test/log-entries.ts";
import { excerpt } from "./excerpt.ts";
import { foldTurn, summaryFromFold } from "./summary-fold.ts";

const MAIN = "session-main";
const SUB = "session-sub";

type ToolKind = "edit" | "read" | "execute" | "other";
type Step =
  | { k: "chunk"; thought: boolean; messageId: string | null | undefined; sub: boolean; text: string }
  | { k: "tool"; sub: boolean; title: string; kind: ToolKind }
  | { k: "update"; ref: number; title: string | null | undefined; kind: ToolKind | null | undefined; status: "in_progress" | "completed" | "failed" | undefined }
  | { k: "plan" }
  | { k: "ask"; ref: number | null; title: string | undefined; kind: ToolKind | undefined; sub: boolean };

const LONG = "The bakery on Juniper Lane opens at nine and closes at five. ".repeat(5);
const text = fc.constantFrom("Hel", "lo", " ", "\n\n  ", "", "The opening hours are 9-17.", LONG);
const toolKind = fc.constantFrom<ToolKind>("edit", "read", "execute", "other");
const title = fc.constantFrom("Edit notes.txt", "Run the tests", "Read hours.md");

const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      k: fc.constant("chunk" as const),
      thought: fc.boolean(),
      messageId: fc.constantFrom<string | null | undefined>(undefined, null, "msg-1", "msg-2"),
      sub: fc.boolean(),
      text,
    }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("tool" as const), sub: fc.boolean(), title, kind: toolKind }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant("update" as const),
      ref: fc.nat({ max: 5 }),
      title: fc.option(fc.option(title, { nil: null }), { nil: undefined }),
      kind: fc.option(fc.option(toolKind, { nil: null }), { nil: undefined }),
      status: fc.option(fc.constantFrom("in_progress" as const, "completed" as const, "failed" as const), { nil: undefined }),
    }),
  },
  { weight: 1, arbitrary: fc.constant({ k: "plan" as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant("ask" as const),
      ref: fc.option(fc.nat({ max: 5 }), { nil: null }),
      title: fc.option(title, { nil: undefined }),
      kind: fc.option(toolKind, { nil: undefined }),
      sub: fc.boolean(),
    }),
  },
);

const turns = fc.array(fc.array(step, { maxLength: 12 }), { minLength: 1, maxLength: 3 });

/** One turn's entries after its user message, as the service stores them. */
const bodiesOf = (steps: Step[], turn: number): Body[] => {
  const tools: string[] = [];
  const session = (sub: boolean) => (sub ? SUB : MAIN);
  return steps.flatMap((s, i): Body[] => {
    switch (s.k) {
      case "chunk":
        return [inSession((s.thought ? thought : chunk)(s.text, s.messageId), session(s.sub))];
      case "tool": {
        const toolCallId = `tool-${String(turn)}-${String(i)}`;
        tools.push(toolCallId);
        return [inSession(toolCall(toolCallId, s.title, { kind: s.kind, status: "pending" }), session(s.sub))];
      }
      case "update": {
        const toolCallId = tools[s.ref % Math.max(1, tools.length)];
        if (toolCallId === undefined) return [];
        return [
          inSession(
            toolUpdate(toolCallId, {
              ...(s.title === undefined ? {} : { title: s.title }),
              ...(s.kind === undefined ? {} : { kind: s.kind }),
              ...(s.status === undefined ? {} : { status: s.status }),
            }),
            MAIN,
          ),
        ];
      }
      case "plan":
        return [inSession(plan("Edit the hours"), MAIN)];
      case "ask": {
        const toolCallId = s.ref === null || tools.length === 0 ? `unknown-${String(turn)}-${String(i)}` : (tools[s.ref % tools.length] as string);
        const asked = { toolCallId, ...(s.title === undefined ? {} : { title: s.title }), ...(s.kind === undefined ? {} : { kind: s.kind }) };
        return [inSession(permissionRequested(`request-${String(turn)}-${String(i)}`, asked), session(s.sub))];
      }
    }
  });
};

test("the summary's activity, lastText and request titles agree with the chat's fold of the same log, after every entry", () => {
  fc.assert(
    fc.property(turns, (generated) => {
      const log: LogEntry[] = [];
      let fold = emptyFold(MAIN);
      let summary = { id: "agent-1", state: "working" } as AgentSummary;
      const lastText = () => summary.lastText ?? "";

      for (const [turn, steps] of generated.entries()) {
        const bodies = [inSession(user("Fix the hours"), MAIN), ...bodiesOf(steps, turn), inSession(turnEnded(), MAIN)];
        for (const [index, body] of bodies.entries()) {
          const [entry] = entries([body], { firstSeq: log.length + 1 });
          if (entry === undefined) throw new Error("no entry");
          log.push(entry);
          fold = foldTurn(fold, MAIN, [entry]);
          const chat = foldLog(log, MAIN);
          const when = `after entry ${String(index + 1)} of turn ${String(turn + 1)} (${entry.type})`;

          expect(summaryFromFold(fold, summary, "working").activity ?? null, `activity ${when}`).toStrictEqual(activityOf(chat));

          if (entry.type === "permission_requested") {
            expect(permissionOf(fold, entry.requestId), `the request's title and kind ${when}`).toEqual(permissionOf(chat, entry.requestId));
            summary = summaryFromFold(fold, summary, "waiting");
            expect(summary.activity, `activity while waiting ${when}`).toBeNull();
            expect(lastText(), `lastText ${when}`).toBe(excerpt(lastMainMessage(chat) ?? ""));
          }
        }
        summary = summaryFromFold(fold, summary, "done");
        expect(summary.activity, `activity at the end of turn ${String(turn + 1)}`).toBeNull();
        expect(lastText(), `lastText at the end of turn ${String(turn + 1)}`).toBe(excerpt(lastMainMessage(foldLog(log, MAIN)) ?? ""));
      }
    }),
    { numRuns: 300 },
  );
});
