// The row and the chat agree, through the real manager: the summary is written from the turn's fold at the points the
// desktop reads it. The fold itself is checked for any log in summary-fold.test.ts; this drives one scripted log
// through the fake agent's `replay` scenario and checks what only the running service shows: updates arriving over
// ACP, the summary written after the log, and the latest `agent_changed` alert carrying the stored activity (or the
// desktop would never refetch the row). Checked at each pause mid-turn (the agent stays working), at each batch of
// open requests (with a retitling update between two of them) and at each turn's end.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { activityOf, foldLog, lastMainMessage, permissionOf } from "@wombat/shared/log-fold";
import { expect, test } from "vitest";

import type { ReplayStep } from "../../test/fake-agent.ts";
import { REPO, setup, TEST_TIMEOUT_MS, WAIT_MS, waitFor, type Setup } from "../../test/manager-fixtures.ts";
import { excerpt } from "./excerpt.ts";

/**
 * Where the test checks a turn, in order: each batch of requests (its size), and each pause (the file that releases
 * it, and how many updates the turn has sent before it).
 */
type Checkpoint = { k: "batch"; size: number } | { k: "pause"; file: string; sent: number };

const message = (text: string): ReplayStep => ({ send: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });

/** Two turns: a pause before anything, a message and a tool, two requests with a retitle between; then a request before any message. */
const turnsIn = (pauseDir: string): { replay: ReplayStep[]; checkpoints: Checkpoint[] }[] => {
  const opening = join(pauseDir, "pause-opening");
  const atTool = join(pauseDir, "pause-at-tool");
  return [
    {
      replay: [
        { awaitFile: opening },
        message("Looking at the hours."),
        { send: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Edit notes.txt", kind: "edit", status: "pending" } },
        { awaitFile: atTool },
        { ask: { toolCallId: "tool-1" } },
        { send: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "Edit hours.md" } },
        { ask: { toolCallId: "tool-unknown", title: "Run the tests", kind: "execute" }, sub: true },
        { awaitAnswers: true },
        message("The hours are fixed."),
      ],
      checkpoints: [
        { k: "pause", file: opening, sent: 0 },
        { k: "pause", file: atTool, sent: 2 },
        { k: "batch", size: 2 },
      ],
    },
    {
      replay: [{ ask: { toolCallId: "tool-unknown-2", title: "Run the tests", kind: "execute" } }, { awaitAnswers: true }],
      checkpoints: [{ k: "batch", size: 1 }],
    },
  ];
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
    const { id } = await t.manager.start("fake-replay", REPO);

    for (const [turn, { replay, checkpoints }] of turnsIn(t.root).entries()) {
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
  },
  TEST_TIMEOUT_MS,
);
