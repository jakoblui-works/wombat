// Lasting check "The row and the chat agree" (contracts "The log fold" and "`AgentSummary.lastText` meaning"): for any
// log an agent writes, the agents list and Needs me show what the chat shows. At every summary write the test can pin
// down (each batch of open permission requests, each turn's end), the summary's lastText is the excerpt of the chat's
// latest main-session agent message, and each pending request's title and kind are the chat's. "The chat" is the fold
// over the stored log with plain concatenation, as the desktop folds it; the service may fold differently inside (per
// turn, keeping only what an excerpt needs) but must read the same.
//
//
// Lasting check "Row and chat agree on activity" (contract "Agent activity on the summary", T4): the row's
// summary.activity is what `activityOf` reads from the chat's fold of the same log, while the agent works, and null
// while it doesn't. Checked at each pause the agent makes mid-turn (the replay scenario's `awaitFile` step: the agent
// stays working, nothing is asked of the user), once the log holds every update sent before the pause; there the
// latest `agent_changed` alert must already carry the stored activity, or the desktop would never refetch the row. At
// each batch of requests (waiting) and each turn's end (done), the activity is null. Pauses check the activity and
// the pending requests, not lastText: the contract promises lastText current only at each turn's end, so the service
// needn't write the summary per chunk; lastText stays checked at batches and turn ends.
//
// Logs are generated (fast-check) and driven through the real manager by the fake agent's `replay` scenario: chunks
// with and without messageIds (null too), thoughts, tool calls and updates with null titles and kinds and every
// status, plans, a sub-agent's session, batches of permission requests with tool updates between them, and pauses
// (a turn's first step too, so a new turn's opening activity is checked). Requests and tool updates name tool calls
// of their own turn or none. That is an accepted limit: the service's fold restarts per turn, so an update naming an
// earlier turn's tool would have no title on the service's side while the chat's fold has one.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import fc from "fast-check";
import { activityOf, foldLog, lastMainMessage, permissionOf } from "@wombat/shared/log-fold";
import { expect, test } from "vitest";

import type { ReplayStep } from "../../test/fake-agent.ts";
import { REPO, setup, WAIT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";
import { excerpt } from "./excerpt.ts";

type Update = Extract<ReplayStep, { send: unknown }>["send"];
type ToolKind = NonNullable<Extract<Update, { sessionUpdate: "tool_call" }>["kind"]>;

const NUM_RUNS = 30;
const TEST_TIMEOUT_MS = 120_000;

// Generated turns, before tool references are resolved to ids.

type ChunkStep = { k: "chunk"; thought: boolean; messageId: string | null | undefined; sub: boolean; text: string };
type ToolStep = { k: "tool"; sub: boolean; title: string; kind: ToolKind };
type UpdateStep = {
  k: "update";
  ref: number;
  title: string | null | undefined;
  kind: ToolKind | null | undefined;
  status: "in_progress" | "completed" | "failed" | undefined;
};
/** `retitlesAsked`: the update after this request goes to the request's own tool call (the one a frozen row would miss). */
type Ask = { ref: number | null; title: string | undefined; kind: ToolKind | undefined; sub: boolean; updateAfter: UpdateStep | null; retitlesAsked: boolean };
type Step = ChunkStep | ToolStep | UpdateStep | { k: "plan" } | { k: "batch"; asks: Ask[] } | { k: "pause" };

const LONG = "The bakery on Juniper Lane opens at nine and closes at five. ".repeat(5);
const text = fc.constantFrom("Hel", "lo", " ", "\n\n  ", "", "The opening hours are 9-17.", LONG);
const toolKind = fc.constantFrom<ToolKind>("edit", "read", "execute", "other");
const title = fc.constantFrom("Edit notes.txt", "Run the tests", "Read hours.md");

const updateStep: fc.Arbitrary<UpdateStep> = fc.record({
  k: fc.constant("update" as const),
  ref: fc.nat({ max: 5 }),
  title: fc.option(fc.option(title, { nil: null }), { nil: undefined }),
  kind: fc.option(fc.option(toolKind, { nil: null }), { nil: undefined }),
  status: fc.option(fc.constantFrom("in_progress" as const, "completed" as const, "failed" as const), { nil: undefined }),
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
  { weight: 3, arbitrary: fc.constant({ k: "pause" as const }) },
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
  fc
    .tuple(fc.constantFrom("none", "batch", "pause"), fc.array(step, { minLength: 1, maxLength: 10 }))
    .map(([opening, steps]): Step[] => (opening === "batch" ? [OPENING_BATCH, ...steps] : opening === "pause" ? [{ k: "pause" }, ...steps] : steps)),
  { minLength: 1, maxLength: 3 },
);

/**
 * Where the test checks a turn, in order: each batch of requests (its size), and each pause (the file that releases
 * it, and how many updates the turn has sent before it).
 */
type Checkpoint = { k: "batch"; size: number } | { k: "pause"; file: string; sent: number };

/** One turn as the replay scenario's steps, and its checkpoints in order. Pause files go in `pauseDir`. */
const script = (steps: Step[], turn: number, pauseDir: string): { replay: ReplayStep[]; checkpoints: Checkpoint[] } => {
  const replay: ReplayStep[] = [];
  const checkpoints: Checkpoint[] = [];
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
        checkpoints.push({ k: "batch", size: s.asks.length });
        break;
      case "pause": {
        const file = join(pauseDir, `pause-${randomUUID()}`);
        replay.push({ awaitFile: file });
        checkpoints.push({ k: "pause", file, sent: replay.filter((r) => "send" in r).length });
        break;
      }
    }
  });
  return { replay, checkpoints };
};

/** What the chat shows of the agent's stored log: the chat's reading of it, for the agent's own session. */
const chatOf = (t: Setup, agentId: string, sessionId: string) => foldLog(t.entries(agentId), sessionId);

/** The activity the row must show for the chat's fold: activityOf while the agent works, else none. */
const chatActivity = (t: Setup, agentId: string) => {
  const summary = t.agent(agentId);
  if (!summary) throw new Error(`no summary for ${agentId}`);
  return summary.state === "working" ? activityOf(chatOf(t, agentId, summary.sessionId)) : null;
};

const rowActivity = (t: Setup, agentId: string) => t.agent(agentId)?.activity ?? null;

/** Session updates stored since the turn's user message. */
const updatesThisTurn = (t: Setup, agentId: string) => {
  const entries = t.entries(agentId);
  const start = entries.findLastIndex((entry) => entry.type === "user_message");
  return entries.slice(start + 1).filter((entry) => entry.type === "session_update").length;
};

/** Polls until `check` holds or WAIT_MS passes; says whether it held. The summary is written just after the log. */
const settles = async (check: () => boolean) => {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
};

/**
 * The summary as stored agrees with the chat over the log stored so far. `lastText: false` at a pause mid-turn: the
 * contract promises lastText current only at a turn's end (and it is pinned at each batch of requests too).
 */
const expectAgreement = (t: Setup, agentId: string, when: string, { lastText = true }: { lastText?: boolean } = {}) => {
  const summary = t.agent(agentId);
  if (!summary) throw new Error(`no summary for ${agentId}`);
  const chat = chatOf(t, agentId, summary.sessionId);
  expect(rowActivity(t, agentId), `activity ${when} (state ${summary.state})`).toStrictEqual(chatActivity(t, agentId));
  if (lastText) expect(summary.lastText ?? "", `lastText ${when}`).toBe(excerpt(lastMainMessage(chat) ?? ""));
  expect(
    summary.pendingPermissions.map(({ requestId, title, kind }) => ({ requestId, title, kind })),
    `pending permissions ${when}`,
  ).toEqual(summary.pendingPermissions.map(({ requestId }) => ({ requestId, ...permissionOf(chat, requestId) })));
};

test(
  "the summary's lastText, pending permissions and activity agree with the chat's fold of the stored log, at each pause mid-turn, each batch of requests and each turn's end",
  async () => {
    const t = setup();
    // The activity of the summary each agent_changed alert was committed with, per agent: what the desktop refetches.
    const alerted = new Map<string, unknown>();
    t.manager.onCommitted((event) => {
      if (event.type === "agent_changed") alerted.set(event.agentId, rowActivity(t, event.agentId));
    });
    await fc.assert(
      fc.asyncProperty(turns, async (generated) => {
        const { id } = await t.manager.start("fake-replay", REPO);
        try {
          for (const [turn, steps] of generated.entries()) {
            const { replay, checkpoints } = script(steps, turn, t.root);
            await t.manager.send(id, { text: JSON.stringify(replay) });
            for (const [index, checkpoint] of checkpoints.entries()) {
              const when = `in turn ${String(turn + 1)}, checkpoint ${String(index + 1)} (${checkpoint.k})`;
              if (checkpoint.k === "pause") {
                await waitFor(`${String(checkpoint.sent)} updates stored ${when}`, () => updatesThisTurn(t, id) >= checkpoint.sent);
                await waitFor(`state working ${when}`, () => t.agent(id)?.state === "working");
                expect(chatActivity(t, id), `the chat's activity ${when}`).not.toBeNull();
                await settles(() => isDeepStrictEqual(rowActivity(t, id), chatActivity(t, id)));
                expectAgreement(t, id, when, { lastText: false });
                expect(alerted.get(id) ?? null, `the latest agent_changed alert's activity ${when}`).toStrictEqual(rowActivity(t, id));
                writeFileSync(checkpoint.file, "");
                continue;
              }
              await waitFor(`${String(checkpoint.size)} open requests ${when}`, () => t.agent(id)?.pendingPermissions.length === checkpoint.size);
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
