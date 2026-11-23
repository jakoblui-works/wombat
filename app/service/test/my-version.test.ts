// My own version of a proposal over the routes, on the real server with a stub agent token for the propose call:
// approve applies the version it names only while that is the current one, so under my draft the agent's number
// writes nothing; and a draft the service can't take answers with the code the app acts on, and stores nothing (an item
// draft's refusal names the fields that don't pass, in the shared Problem's keys only).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ErrorBody } from "@wombat/shared/api";
import { Problem } from "@wombat/shared/items";
import { expect, test } from "vitest";

import { TOOL } from "../src/items/tools.ts";
import { IDS, VALID_FILES, writeRoot } from "./items-fixtures.ts";
import { REPO, TEST_TIMEOUT_MS } from "./manager-fixtures.ts";
import { callTool, STUB_AGENT, STUB_TOKEN } from "./mcp-fixtures.ts";
import { expectError, serve, type Response, type Served } from "./server-fixtures.ts";
import { WORKSPACE } from "./store-fixtures.ts";

const NOTES = "# Pairing notes\n\n- Driver and navigator swap every half hour.\n- The navigator keeps the notes.\n\n## Review\n\nOpen one pull request per finished test.\n";
const EDIT = { old: "swap every half hour", new: "swap after each finished test" };
const PROPOSED = NOTES.replace(EDIT.old, EDIT.new);
/** My edit of the proposed text, in a line the agent's edit doesn't touch. */
const MINE = PROPOSED.replace("per finished test", "per pairing day");

type Sent = { status?: string; version?: number; editedByMe?: boolean };

const open = async () => {
  const s = await serve({ agentTokens: { [STUB_TOKEN]: STUB_AGENT } });
  /** Writes the notes at `relative` in the workspace and has the agent propose EDIT on them. */
  const propose = async (relative: string) => {
    const path = join(s.root, REPO, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, NOTES);
    const answer = await callTool(s, STUB_TOKEN, TOOL.proposeChange, { path, reason: "The rotation rule changed.", edits: [EDIT] });
    expect(answer.isError, answer.text).toBe(false);
    return { id: (answer.json as { proposed: string }).proposed, path };
  };
  return { s, propose };
};

const approve = (s: Served, id: string, version: number) => s.api("POST", `/proposals/${id}/approve`, { version });
const putDraft = (s: Served, id: string, body: Record<string, unknown>) => s.api("PUT", `/proposals/${id}/draft`, body);

const sent = (response: Response, what: string): Sent & { version: number } => {
  expect(response.status, `${what} → ${response.text}`).toBe(200);
  const proposal = response.json as Sent;
  return { ...proposal, version: proposal.version ?? 0 };
};

/** What a refused call must leave as it was. */
const stateOf = (s: Served, id: string) => ({ proposal: s.store.getProposal(id), versions: s.store.listVersions(id), seq: s.store.currentSeq() });

test(
  "under my draft, approving the agent's version answers proposal_changed and writes nothing; approving my draft's number writes my text",
  async () => {
    const { s, propose } = await open();
    const { id, path } = await propose("docs/pairing-notes.md");
    const drafted = sent(await putDraft(s, id, { onVersion: 1, text: MINE }), "save my draft");
    expect(drafted).toMatchObject({ status: "pending", editedByMe: true });
    expect(drafted.version, "my draft has a number of its own").not.toBe(1);
    const before = stateOf(s, id);

    expectError(await approve(s, id, 1), 409, "proposal_changed", "approving the agent's version under my draft");

    expect(readFileSync(path, "utf8"), "the refused approve wrote nothing").toBe(NOTES);
    expect(stateOf(s, id)).toEqual(before);

    expect(sent(await approve(s, id, drafted.version), "approving my draft")).toMatchObject({ status: "approved", editedByMe: true });
    expect(readFileSync(path, "utf8")).toBe(MINE);
  },
  TEST_TIMEOUT_MS,
);

test(
  "a draft on a conflict answers proposal_not_pending, on an older agent version proposal_changed, and one equal to the agent's version invalid_request; none is stored",
  async () => {
    const { s, propose } = await open();
    const conflict = await propose("conflict/pairing-notes.md");
    // By hand, the line the proposal's edit matched changes: its approve ends in a conflict.
    writeFileSync(conflict.path, NOTES.replace(EDIT.old, "swap every twenty minutes"));
    expect(sent(await approve(s, conflict.id, 1), "approve after a hand edit").status).toBe("conflict");
    const revised = await propose("revised/pairing-notes.md");
    const revise = await callTool(s, STUB_TOKEN, TOOL.reviseProposal, { id: revised.id, reason: "Slower.", edits: [{ old: "after each finished test", new: "after every second finished test" }] });
    expect(revise.isError, revise.text).toBe(false);
    const same = await propose("same/pairing-notes.md");

    const cases: [string, string, Record<string, unknown>, number, string][] = [
      ["a draft on a conflict", conflict.id, { onVersion: 1, text: MINE }, 409, "proposal_not_pending"],
      ["a draft on the agent's version before its revise", revised.id, { onVersion: 1, text: MINE }, 409, "proposal_changed"],
      ["a draft equal to the agent's version", same.id, { onVersion: 1, text: PROPOSED }, 400, "invalid_request"],
    ];
    for (const [what, id, body, status, code] of cases) {
      const before = stateOf(s, id);
      expectError(await putDraft(s, id, body), status, code, what);
      expect(stateOf(s, id), `${what}: nothing stored`).toEqual(before);
    }
  },
  TEST_TIMEOUT_MS,
);

test(
  "an item draft with a field that doesn't pass answers invalid_request with problems naming that field, in the shared Problem's keys only",
  async () => {
    const s = await serve({ itemsRoot: writeRoot(VALID_FILES) });
    const { proposal } = s.store.insertProposal(
      { workspace: WORKSPACE, target: "item", path: null, binder: "bugs", itemId: IDS.bug1, kind: "update", file: null, reason: "Seen again on staging.", baseVersion: "9f2c", agentId: STUB_AGENT },
      { fields: { note: "Also seen in Firefox" } },
    );
    const before = stateOf(s, proposal.id);

    // A link to an item outside the property's binder: the writer's problem for it names that item inside the service.
    const refused = await putDraft(s, proposal.id, { onVersion: 1, fields: { order: "twelve", blocks: IDS.bug2 } });

    expectError(refused, 400, "invalid_request", "a draft with a number property set to text");
    const problems = ErrorBody.parse(refused.json).error.problems ?? [];
    expect(problems.map(({ field }) => field), refused.text).toContain("order");
    const raw = (refused.json as { error: { problems?: Record<string, unknown>[] } }).error.problems ?? [];
    for (const problem of raw) expect(Object.keys(problem).every((key) => key in Problem.shape), `only Problem's keys: ${JSON.stringify(problem)}`).toBe(true);
    expect(stateOf(s, proposal.id), "nothing stored").toEqual(before);
  },
  TEST_TIMEOUT_MS,
);
