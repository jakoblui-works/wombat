// One cap for every way an agent proposes: at MAX_OPEN_PROPOSALS open proposals each propose tool is refused alike
// with nothing stored, another agent isn't affected, and the cap never tells a hidden binder from a missing one.
// And one limit on a proposal's versions: at MAX_PROPOSAL_VERSIONS the agent's revise is refused with nothing stored,
// so a revise loop can't fill the database, while my own version is still saved.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { MAX_OPEN_PROPOSALS, MAX_PROPOSAL_VERSIONS } from "@wombat/shared/proposals";
import { expect, test } from "vitest";

import { TOOL } from "../src/items/tools.ts";
import { createProposals } from "../src/proposals/proposals.ts";
import { ProposalRefused } from "../src/proposals/refused.ts";
import type { NewProposal, Store } from "../src/store/store.ts";
import { ACCESS_FILES, HIDDEN, VISIBLE_IDS } from "./access-fixtures.ts";
import { writeRoot } from "./items-fixtures.ts";
import { TEST_TIMEOUT_MS } from "./manager-fixtures.ts";
import { callTool, type ToolAnswer } from "./mcp-fixtures.ts";
import { serve, type Served } from "./server-fixtures.ts";
import { open, tempDir, tempStorePath } from "./store-fixtures.ts";

const FULL = { token: "token-of-the-agent-at-the-cap", agent: "agent-at-the-cap" };
const OTHER = { token: "token-of-another-agent", agent: "agent-with-room" };

const fileProposal = (agentId: string, n: number): NewProposal => ({
  target: "file",
  path: `/home/sam/work/site-web/docs/page-${String(n)}.md`,
  binder: null,
  itemId: null,
  kind: "edit",
  file: null,
  reason: "A typo",
  baseVersion: "4d5e6f",
  agentId,
});
const itemProposal = (agentId: string): NewProposal => ({ target: "item", path: null, binder: "bugs", itemId: VISIBLE_IDS.bug1, kind: "update", file: null, reason: "Seen again", baseVersion: "9f2c", agentId });

/** Gives the agent MAX_OPEN_PROPOSALS proposals that count (file and item, pending and one conflict) and a rejected one. */
const fill = (store: Store, agentId: string) => {
  const ids = Array.from({ length: MAX_OPEN_PROPOSALS + 1 }, (_, n) =>
    n % 2 === 0 ? store.insertProposal(fileProposal(agentId, n), { text: "Fixed.\n" }).proposal.id : store.insertProposal(itemProposal(agentId), { fields: { note: "Seen again" } }).proposal.id,
  );
  const [rejected = "", conflict = ""] = ids;
  store.rejectProposal(rejected);
  store.beginApplying(conflict, 1, {});
  store.settle(conflict, { status: "conflict", problem: { message: "The item changed." } });
  expect(store.countOpen(agentId)).toBe(MAX_OPEN_PROPOSALS);
};

test(
  "at the cap every propose tool is refused with the same text and stores nothing; another agent and the hidden-or-missing answers are unaffected",
  async () => {
    const root = writeRoot(ACCESS_FILES);
    const s: Served = await serve({ itemsRoot: root, agentTokens: { [FULL.token]: FULL.agent, [OTHER.token]: OTHER.agent } });
    const notes = join(s.root, "notes.md");
    writeFileSync(notes, "# Notes\n\nSwap every half hour.\n");
    const versionOf = async (token: string, handle: string) => ((await callTool(s, token, TOOL.getItem, { handle })).json as { version: string }).version;
    /** One valid call per propose tool. */
    const propose = async (token: string): Promise<Record<string, ToolAnswer>> => ({
      [TOOL.proposeChange]: await callTool(s, token, TOOL.proposeChange, { path: notes, reason: "The rule changed.", edits: [{ old: "half hour", new: "hour" }] }),
      [TOOL.proposeCreate]: await callTool(s, token, TOOL.proposeCreate, { binder: "bugs", title: "Seed script hangs", reason: "Seen twice." }),
      [TOOL.proposeUpdate]: await callTool(s, token, TOOL.proposeUpdate, { handle: "BUG-2", fields: { note: "Seen in Zen" }, version: await versionOf(token, "BUG-2"), reason: "Seen again." }),
      [TOOL.proposeDelete]: await callTool(s, token, TOOL.proposeDelete, { handle: "BUG-2", version: await versionOf(token, "BUG-2"), reason: "A duplicate." }),
    });
    /** Calls aimed at the hidden binder and at one that doesn't exist. */
    const aimedAtHidden = async (token: string) =>
      Promise.all([
        callTool(s, token, TOOL.proposeCreate, { binder: HIDDEN.binder, title: "A plan", reason: "Why not." }),
        callTool(s, token, TOOL.proposeCreate, { binder: "no-such-binder", title: "A plan", reason: "Why not." }),
        callTool(s, token, TOOL.proposeUpdate, { handle: HIDDEN.handles[0], fields: { codename: "x" }, version: "9f2c", reason: "Why not." }),
        callTool(s, token, TOOL.proposeDelete, { handle: HIDDEN.handles[0], version: "9f2c", reason: "Why not." }),
      ]);
    const belowTheCap = await aimedAtHidden(FULL.token);
    expect(belowTheCap.map((answer) => answer.isError)).toEqual([true, true, true, true]);
    fill(s.store, FULL.agent);
    const before = { proposals: s.store.listProposals(), seq: s.store.currentSeq() };

    const refused = await propose(FULL.token);
    const atTheCap = await aimedAtHidden(FULL.token);

    const texts = Object.entries(refused).map(([tool, answer]) => {
      expect(answer.isError, `${tool}: ${answer.text}`).toBe(true);
      return answer.text;
    });
    expect(new Set(texts).size, texts.join("\n")).toBe(1);
    expect(atTheCap).toEqual(belowTheCap);
    expect({ proposals: s.store.listProposals(), seq: s.store.currentSeq() }, "nothing stored, no seq taken").toEqual(before);

    const accepted = await propose(OTHER.token);
    for (const [tool, answer] of Object.entries(accepted)) expect(answer.isError, `${tool} by another agent: ${answer.text}`).toBe(false);
    expect(s.store.countOpen(OTHER.agent)).toBe(Object.keys(accepted).length);
  },
  TEST_TIMEOUT_MS,
);

test("at the versions limit the agent's revise is refused and stores nothing, and my own version is still saved", async () => {
  const workspace = tempDir();
  const store = open({ path: tempStorePath() });
  const proposals = createProposals({ store, workspace, agentFolder: () => workspace, onProposal: () => undefined, log: () => undefined });
  const { proposed: id } = await proposals.proposeFile(FULL.agent, join(workspace, "notes.md"), "The notes need a file.", { content: "# Notes\n\nRevision 1.\n" });
  const revise = (n: number) => proposals.revise(FULL.agent, id, "Counted again.", { content: `# Notes\n\nRevision ${String(n)}.\n` });
  // Straight into the store up to one below the limit; the last one through the revise, which is still taken there.
  for (let n = 2; n < MAX_PROPOSAL_VERSIONS; n += 1) store.addAgentVersion(id, { text: `# Notes\n\nRevision ${String(n)}.\n` }, "Counted again.");
  await revise(MAX_PROPOSAL_VERSIONS);
  const atTheLimit = { versions: store.listVersions(id), seq: store.currentSeq() };
  expect(atTheLimit.versions).toHaveLength(MAX_PROPOSAL_VERSIONS);

  await expect(revise(MAX_PROPOSAL_VERSIONS + 1)).rejects.toBeInstanceOf(ProposalRefused);

  expect({ versions: store.listVersions(id), seq: store.currentSeq() }, "nothing stored, no seq taken").toEqual(atTheLimit);
  const mine = await proposals.putDraft(id, MAX_PROPOSAL_VERSIONS, { text: "# Notes\n\nMy own.\n" });
  expect(mine).toMatchObject({ status: "pending", editedByMe: true });
  expect(store.listVersions(id).at(-1)).toMatchObject({ by: "me", content: { text: "# Notes\n\nMy own.\n" } });
});
