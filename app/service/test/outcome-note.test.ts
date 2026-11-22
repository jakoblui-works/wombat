// What an agent is told about its proposals with my next message, on the real manager with a fake agent that answers
// each prompt with the prompt it received: the prompt is the stored note as `renderNote` renders it, then the typed
// text, so the log shows exactly what the agent read; each outcome is told once, and told again only when its message
// never reached the agent; a command carries no note; and a message or a revise names only the agent's own open
// proposal. Proposals are made and decided through the proposals module on the manager's store. One test runs on the
// real server with an items root: there the note names an item by its handle, which only the server's own note source
// (the one that reads the items) can tell.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { LogEntry, ProposalNoteEntry } from "@wombat/shared/api";
import { expect, test } from "vitest";

import { renderNote } from "../src/proposals/note.ts";
import { createProposals } from "../src/proposals/proposals.ts";
import { ProposalRefused } from "../src/proposals/refused.ts";
import { CONFIG_SILENT_FILE, FAKE_CONFIG, RESUME_REFUSED_FILE } from "./fake-agent.ts";
import { ACCESS_FILES, VISIBLE_IDS } from "./access-fixtures.ts";
import { writeRoot } from "./items-fixtures.ts";
import { chunkTexts, REPO, setup, TEST_TIMEOUT_MS, waitFor } from "./manager-fixtures.ts";
import { serve } from "./server-fixtures.ts";
import { WORKSPACE } from "./store-fixtures.ts";

const LIMITS = '{ "maxFiles": 12 }\n';
const POLICY = "export const RETRY = { attempts: 3, backoffMs: 250 };\n";
const REJECT_REASON = "Keep the limits in the settings page, not in a file of their own.";

/** What one message did: the prompt the agent answered with, and the note stored right before the message, if any. */
type Told = { prompt: string; note: ProposalNoteEntry | undefined };

/** A manager with one running echo agent, and the proposals on its store. */
const open = async () => {
  const t = setup();
  const { id: agentId } = await t.manager.start(WORKSPACE, "fake-echo", REPO);
  const folder = join(t.root, REPO);
  const proposals = createProposals({ store: t.store, workspace: t.root, workspaceId: WORKSPACE, agentFolder: () => folder, onProposal: () => undefined, log: () => undefined });
  const notes = () => t.entries(agentId).filter((entry): entry is ProposalNoteEntry => entry.type === "proposal_note");

  /** The turn of the message stored as `seq`: the agent's reply, and the entry right before the message. */
  const toldBy = (seq: number, text: string): Told => {
    const entries = t.entries(agentId);
    const at = entries.findIndex((entry) => entry.seq === seq);
    expect(entries[at], "the stored message holds the typed text only").toMatchObject({ type: "user_message", text });
    const rest = entries.slice(at + 1);
    const end = rest.findIndex((entry) => entry.type === "turn_ended");
    const before: LogEntry | undefined = entries[at - 1];
    return { prompt: chunkTexts(rest.slice(0, end === -1 ? rest.length : end)).join(""), note: before?.type === "proposal_note" ? before : undefined };
  };

  return {
    t,
    agentId,
    folder,
    proposals,
    notes,
    /** `by` (this agent, unless given) proposes a new file in its folder; returns the proposal's id. */
    propose: async (relative: string, content: string, by = agentId) => {
      mkdirSync(dirname(join(folder, relative)), { recursive: true });
      return (await proposals.proposeFile(by, join(folder, relative), "It needs a file of its own.", { content })).proposed;
    },
    /** The agent's outcomes it hasn't been told. */
    untold: () => t.store.undeliveredOutcomes(agentId).map(({ id }) => id),
    /** Sends a message, waits for its turn to end and reads what the agent was told. */
    say: async (text: string, proposalId?: string): Promise<Told> => {
      const turns = t.entries(agentId).filter((entry) => entry.type === "turn_ended").length;
      const { seq } = await t.manager.send(agentId, { text, ...(proposalId === undefined ? {} : { proposalId }) });
      await t.turnEnded(agentId, turns + 1);
      return toldBy(seq, text);
    },
  };
};

/** The prompt is the note as `renderNote` renders it, then the typed text, with only white space between them. */
const expectNoteThenText = ({ prompt, note }: Told, text: string) => {
  expect(note, `a note right before the message; the prompt was: ${prompt}`).toBeDefined();
  if (note === undefined) return;
  const rendered = renderNote(note);
  expect(rendered.trim()).not.toBe("");
  expect(prompt.startsWith(rendered), `the prompt starts with the rendered note.\nprompt: ${prompt}\nrendered: ${rendered}`).toBe(true);
  expect(prompt.endsWith(text), `the typed text ends the prompt: ${prompt}`).toBe(true);
  expect(prompt.slice(rendered.length, prompt.length - text.length).trim(), "nothing between the note and the typed text").toBe("");
};

test(
  "the agent's prompt is the stored note's rendering followed by the typed text, the note sits right before its message, and the next message carries none",
  async () => {
    const { proposals, propose, untold, say, notes } = await open();
    const approved = await propose("src/retry-policy.ts", POLICY);
    const rejected = await propose("config/limits.json", LIMITS);
    await proposals.approve(approved, 1);
    await proposals.reject(rejected, REJECT_REASON);
    expect(untold()).toEqual([approved, rejected]);

    const typed = "Thanks. Now look at the review rule.";
    const told = await say(typed);

    expectNoteThenText(told, typed);
    expect(told.note?.outcomes).toMatchObject([
      { proposalId: approved, outcome: "approved" },
      { proposalId: rejected, outcome: "rejected", reason: REJECT_REASON },
    ]);
    expect(told.prompt, "the agent reads my reason").toContain(REJECT_REASON);
    expect(untold(), "told with the message that stored the note").toEqual([]);

    const next = "And who keeps the notes?";
    const after = await say(next);

    expect(after, "the following prompt is the typed text alone").toEqual({ prompt: next, note: undefined });
    expect(notes()).toHaveLength(1);
  },
  TEST_TIMEOUT_MS,
);

// A note stored with a message that never reached the agent would otherwise be lost: the log shows it, the agent
// never read it, and nothing would tell the outcome again.
test.each<[string, "refused" | "stopped"]>([
  ["whose resume fails", "refused"],
  ["that is stopped while its settings are set again", "stopped"],
])(
  "a message to a stopped agent %s leaves its outcome untold, and the next message tells it",
  async (_what, way) => {
    const { t, agentId, folder, proposals, propose, untold, say } = await open();
    const id = await propose("config/limits.json", LIMITS);
    await proposals.reject(id, REJECT_REASON);
    // A setting away from its default, which a resume sets again before the message's turn.
    await t.manager.setConfig(agentId, FAKE_CONFIG.effort.id, "high");
    await t.manager.stop(agentId);
    await waitFor("the agent to be stopped", () => t.agent(agentId)?.state === "stopped");
    const switchFile = join(folder, way === "refused" ? RESUME_REFUSED_FILE : CONFIG_SILENT_FILE);
    writeFileSync(switchFile, "");

    await t.manager.send(agentId, { text: "Still there?" });
    expect(untold(), "stored with the message, the note counts as told").toEqual([]);
    if (way === "stopped") {
      // The session is taken up and the agent leaves the setting unanswered: the stop ends it before the prompt.
      await waitFor("the agent's new process to hold the session", () => t.agent(agentId)?.hasProcess === true);
      await t.manager.stop(agentId);
    }
    await t.turnEnded(agentId, 1);

    await waitFor("the outcome to be untold again", () => untold().includes(id));
    expect(chunkTexts(t.entries(agentId)), "the agent never answered the message").toEqual([]);

    rmSync(switchFile);
    await waitFor("the agent to take a message again", () => t.agent(agentId)?.state !== "working");
    const typed = "Carry on with the settings page.";
    const told = await say(typed);

    expectNoteThenText(told, typed);
    expect(told.note?.outcomes).toMatchObject([{ proposalId: id, outcome: "rejected", reason: REJECT_REASON }]);
    expect(untold()).toEqual([]);
  },
  TEST_TIMEOUT_MS,
);

test(
  "a message starting with / reaches the agent as typed and tells no outcome, which waits for the next message; with a proposal it is refused and nothing is stored",
  async () => {
    const { t, agentId, proposals, propose, untold, say, notes } = await open();
    const rejected = await propose("config/limits.json", LIMITS);
    const pending = await propose("src/retry-policy.ts", POLICY);
    await proposals.reject(rejected, REJECT_REASON);

    const command = "/compact keep the proposals";
    expect(await say(command)).toEqual({ prompt: command, note: undefined });
    expect(untold(), "the outcome still waits").toEqual([rejected]);

    const before = { log: t.entries(agentId), seq: t.store.currentSeq() };
    await expect(t.manager.send(agentId, { text: command, proposalId: pending })).rejects.toMatchObject({ code: "invalid_request" });
    expect({ log: t.entries(agentId), seq: t.store.currentSeq() }, "nothing stored, nothing sent").toEqual(before);
    expect(untold()).toEqual([rejected]);

    const typed = "Make the backoff longer.";
    const told = await say(typed, pending);
    expectNoteThenText(told, typed);
    expect(told.note).toMatchObject({ outcomes: [{ proposalId: rejected, outcome: "rejected" }], reference: { proposalId: pending } });
    expect(notes()).toHaveLength(1);
  },
  TEST_TIMEOUT_MS,
);

// One answer for all three, so an agent can't learn from a refusal that an id exists, whose it is or how it was decided.
test(
  "a revise and a message's proposal take only the agent's own open proposal: another agent's, a decided and an unknown one are refused alike, and nothing is stored",
  async () => {
    const { t, agentId, proposals, propose, say } = await open();
    const mine = await propose("src/retry-policy.ts", POLICY);
    const decided = await propose("config/limits.json", LIMITS);
    await proposals.approve(decided, 1);
    const theirs = await propose("docs/their-notes.md", "# Notes\n", "agent-someone-else");
    const others = { unknown: "0196f3c2-0000-7000-8000-00000000dead", theirs, decided };
    const state = () => ({
      log: t.entries(agentId),
      seq: t.store.currentSeq(),
      untold: t.store.undeliveredOutcomes(agentId),
      proposals: Object.values(others).map((id) => ({ proposal: t.store.getProposal(id), versions: t.store.listVersions(id) })),
    });
    const before = state();
    /** The refusal of `call`, with the id it names replaced so the three can be compared. */
    const refusalOf = async (call: Promise<unknown>, id: string) => {
      const error = await call.then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error, `refused for ${id}`).toBeInstanceOf(Error);
      const { code, message } = error as Error & { code?: string };
      return { refused: error instanceof ProposalRefused, code, message: message.replaceAll(id, "<id>") };
    };

    const revises: Record<string, unknown> = {};
    const messages: Record<string, unknown> = {};
    for (const [what, id] of Object.entries(others)) {
      revises[what] = await refusalOf(proposals.revise(agentId, id, "Mine now.", { content: "# Taken over\n" }), id);
      messages[what] = await refusalOf(t.manager.send(agentId, { text: "Change this one, please.", proposalId: id }), id);
    }

    expect(revises.unknown, "a revise's refusal is the tool's own").toMatchObject({ refused: true });
    expect(messages.unknown).toMatchObject({ code: "proposal_not_found" });
    for (const what of ["theirs", "decided"]) {
      expect(revises[what], `revising ${what} reads like an unknown id`).toEqual(revises.unknown);
      expect(messages[what], `a message about ${what} reads like one about an unknown id`).toEqual(messages.unknown);
    }
    expect(state(), "nothing stored, nothing sent").toEqual(before);

    // The agent's own open proposal is taken by both.
    expect(await proposals.revise(agentId, mine, "A longer backoff.", { content: POLICY.replace("250", "500") })).toMatchObject({ revised: mine });
    expect((await say("Make it three attempts.", mine)).note?.reference).toMatchObject({ proposalId: mine });
  },
  TEST_TIMEOUT_MS,
);

test(
  "on the server with items, the note for a decided item proposal names the item by its handle",
  async () => {
    const s = await serve({ itemsRoot: writeRoot(ACCESS_FILES) });
    const { id: agentId } = await s.manager.start(WORKSPACE, "fake-echo", REPO);
    const { proposal } = s.store.insertProposal(
      { workspace: WORKSPACE, target: "item", path: null, binder: "bugs", itemId: VISIBLE_IDS.bug2, kind: "update", file: null, reason: "Seen again", baseVersion: "9f2c", agentId },
      { fields: { note: "Also in Chromium" } },
    );
    const rejected = await s.api("POST", `/proposals/${proposal.id}/reject`, { reason: "Not a duplicate." });
    expect(rejected.status, rejected.text).toBe(200);

    const sent = await s.api("POST", `/agents/${agentId}/messages`, { text: "Anything else in that bug?" });
    expect(sent.status, sent.text).toBeLessThan(300);
    await s.turnEnded(agentId);

    const note = s.entries(agentId).find((entry): entry is ProposalNoteEntry => entry.type === "proposal_note");
    expect(note?.outcomes).toMatchObject([{ proposalId: proposal.id, outcome: "rejected", label: "BUG-2" }]);
  },
  TEST_TIMEOUT_MS,
);
