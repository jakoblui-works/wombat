// Lasting check "The row and the chat agree" (contracts "The log fold" and "`AgentSummary.lastText` meaning"): for any
// log an agent writes, the agents list and Needs me show what the chat shows. At every summary write the test can pin
// down (each batch of open permission requests, each turn's end), the summary's lastText is the excerpt of the chat's
// latest main-session agent message, and each pending request's title and kind are the chat's. "The chat" is the fold
// over the stored log with plain concatenation, as the desktop folds it; the service may fold differently inside (per
// turn, keeping only what an excerpt needs) but must read the same.
//
// Logs are generated (fast-check) and driven through the real manager by the fake agent's `replay` scenario: chunks
// with and without messageIds (null too), thoughts, tool calls and updates with null titles and kinds, plans, a
// sub-agent's session, and batches of permission requests with tool updates between them. Requests name tool calls of
// their own turn or none (accepted limit, interface-S1 T2: the service's fold restarts per turn).
import fc from "fast-check";
import { emptyFold, foldEntry, lastMainMessage, permissionOf } from "@wombat/shared/log-fold";
import { expect, test } from "vitest";

import type { ReplayStep } from "../../test/fake-agent.ts";
import { REPO, setup, waitFor, type Setup } from "../../test/manager-fixtures.ts";
import { excerpt } from "./excerpt.ts";

type Update = Extract<ReplayStep, { send: unknown }>["send"];
type ToolKind = NonNullable<Extract<Update, { sessionUpdate: "tool_call" }>["kind"]>;

const NUM_RUNS = 30;
const TEST_TIMEOUT_MS = 120_000;

// Generated turns, before tool references are resolved to ids.

type ChunkStep = { k: "chunk"; thought: boolean; messageId: string | null | undefined; sub: boolean; text: string };
type ToolStep = { k: "tool"; sub: boolean; title: string; kind: ToolKind };
type UpdateStep = { k: "update"; ref: number; title: string | null | undefined; kind: ToolKind | null | undefined; status: "in_progress" | "completed" | undefined };
/** `retitlesAsked`: the update after this request goes to the request's own tool call (the one a frozen row would miss). */
type Ask = { ref: number | null; title: string | undefined; kind: ToolKind | undefined; sub: boolean; updateAfter: UpdateStep | null; retitlesAsked: boolean };
type Step = ChunkStep | ToolStep | UpdateStep | { k: "plan" } | { k: "batch"; asks: Ask[] };

const LONG = "The bakery on Juniper Lane opens at nine and closes at five. ".repeat(5);
const text = fc.constantFrom("Hel", "lo", " ", "\n\n  ", "", "The opening hours are 9-17.", LONG);
const toolKind = fc.constantFrom<ToolKind>("edit", "read", "execute", "other");
const title = fc.constantFrom("Edit notes.txt", "Run the tests", "Read hours.md");

const updateStep: fc.Arbitrary<UpdateStep> = fc.record({
  k: fc.constant("update" as const),
  ref: fc.nat({ max: 5 }),
  title: fc.option(fc.option(title, { nil: null }), { nil: undefined }),
  kind: fc.option(fc.option(toolKind, { nil: null }), { nil: undefined }),
  status: fc.option(fc.constantFrom("in_progress" as const, "completed" as const), { nil: undefined }),
});

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
  { weight: 2, arbitrary: updateStep },
  { weight: 1, arbitrary: fc.constant({ k: "plan" as const }) },
  {
    weight: 2,
    arbitrary: fc.record({
      k: fc.constant("batch" as const),
      asks: fc.array(
        fc.record({
          ref: fc.option(fc.nat({ max: 5 }), { nil: null }),
          title: fc.option(title, { nil: undefined }),
          kind: fc.option(toolKind, { nil: undefined }),
          sub: fc.boolean(),
          updateAfter: fc.option(updateStep, { nil: null }),
          retitlesAsked: fc.boolean(),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  },
);

/** A request asked before anything else in the turn: a summary write while the fold holds no message of this turn yet. */
const OPENING_BATCH: Step = { k: "batch", asks: [{ ref: null, title: "Run the tests", kind: "execute", sub: false, updateAfter: null, retitlesAsked: false }] };

const turns = fc.array(
  fc.tuple(fc.boolean(), fc.array(step, { minLength: 1, maxLength: 10 })).map(([opening, steps]) => (opening ? [OPENING_BATCH, ...steps] : steps)),
  { minLength: 1, maxLength: 3 },
);

/** One turn as the replay scenario's steps, and the size of each batch of requests it asks, in order. */
const script = (steps: Step[], turn: number): { replay: ReplayStep[]; batches: number[] } => {
  const replay: ReplayStep[] = [];
  const batches: number[] = [];
  const tools: string[] = [];
  const toolUpdate = (update: UpdateStep): ReplayStep | undefined => {
    const toolCallId = tools[update.ref % Math.max(1, tools.length)];
    if (toolCallId === undefined) return undefined;
    return {
      send: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        ...(update.title === undefined ? {} : { title: update.title }),
        ...(update.kind === undefined ? {} : { kind: update.kind }),
        ...(update.status === undefined ? {} : { status: update.status }),
      },
    };
  };
  steps.forEach((s, i) => {
    switch (s.k) {
      case "chunk":
        replay.push({
          send: {
            sessionUpdate: s.thought ? "agent_thought_chunk" : "agent_message_chunk",
            ...(s.messageId === undefined ? {} : { messageId: s.messageId }),
            content: { type: "text", text: s.text },
          },
          sub: s.sub,
        });
        break;
      case "tool": {
        const toolCallId = `tool-${String(turn)}-${String(i)}`;
        tools.push(toolCallId);
        replay.push({ send: { sessionUpdate: "tool_call", toolCallId, title: s.title, kind: s.kind, status: "pending" }, sub: s.sub });
        break;
      }
      case "update": {
        const update = toolUpdate(s);
        if (update) replay.push(update);
        break;
      }
      case "plan":
        replay.push({ send: { sessionUpdate: "plan", entries: [{ content: "Edit the hours", priority: "medium", status: "pending" }] } });
        break;
      case "batch":
        s.asks.forEach((ask, j) => {
          const toolCallId = ask.ref === null || tools.length === 0 ? `unknown-${String(turn)}-${String(i)}-${String(j)}` : (tools[ask.ref % tools.length] as string);
          replay.push({
            ask: { toolCallId, ...(ask.title === undefined ? {} : { title: ask.title }), ...(ask.kind === undefined ? {} : { kind: ask.kind }) },
            sub: ask.sub,
          });
          // Updates between the batch's requests, never after its last: the last request's summary write sees them all.
          // A retitle of the asked tool always changes its title (cleared, or another one).
          const after =
            ask.updateAfter && ask.retitlesAsked && ask.ref !== null ? { ...ask.updateAfter, ref: ask.ref, title: ask.updateAfter.title ?? null } : ask.updateAfter;
          const update = j < s.asks.length - 1 && after ? toolUpdate(after) : undefined;
          if (update) replay.push(update);
        });
        replay.push({ awaitAnswers: true });
        batches.push(s.asks.length);
        break;
    }
  });
  return { replay, batches };
};

/** What the chat shows of the agent's stored log: the fold with plain concatenation, for the agent's own session. */
const chatOf = (t: Setup, agentId: string, sessionId: string) => {
  const state = emptyFold(sessionId);
  for (const entry of t.entries(agentId)) foldEntry(state, entry, { keepText: (kept, chunk) => kept + chunk });
  return state;
};

/** The summary as stored agrees with the chat over the log stored so far. */
const expectAgreement = (t: Setup, agentId: string, when: string) => {
  const summary = t.agent(agentId);
  if (!summary) throw new Error(`no summary for ${agentId}`);
  const chat = chatOf(t, agentId, summary.sessionId);
  expect(summary.lastText ?? "", `lastText ${when}`).toBe(excerpt(lastMainMessage(chat) ?? ""));
  expect(
    summary.pendingPermissions.map(({ requestId, title, kind }) => ({ requestId, title, kind })),
    `pending permissions ${when}`,
  ).toEqual(summary.pendingPermissions.map(({ requestId }) => ({ requestId, ...permissionOf(chat, requestId) })));
};

test(
  "the summary's lastText and pending permissions agree with the chat's fold of the stored log, at each batch of requests and each turn's end",
  async () => {
    const t = setup();
    await fc.assert(
      fc.asyncProperty(turns, async (generated) => {
        const { id } = await t.manager.start("fake-replay", REPO);
        try {
          for (const [turn, steps] of generated.entries()) {
            const { replay, batches } = script(steps, turn);
            await t.manager.send(id, { text: JSON.stringify(replay) });
            for (const [batch, size] of batches.entries()) {
              const when = `in turn ${String(turn + 1)}, batch ${String(batch + 1)}`;
              await waitFor(`${String(size)} open requests ${when}`, () => t.agent(id)?.pendingPermissions.length === size);
              expectAgreement(t, id, when);
              for (const { requestId } of t.agent(id)?.pendingPermissions ?? []) t.manager.answer(id, requestId, "allow_once");
            }
            await t.turnEnded(id, turn + 1);
            await waitFor(`state done after turn ${String(turn + 1)}`, () => t.agent(id)?.state === "done");
            expectAgreement(t, id, `at the end of turn ${String(turn + 1)}`);
          }
        } finally {
          await t.manager.stop(id);
        }
      }),
      { numRuns: NUM_RUNS, interruptAfterTimeLimit: TEST_TIMEOUT_MS / 2, markInterruptAsFailure: true },
    );
  },
  TEST_TIMEOUT_MS,
);
