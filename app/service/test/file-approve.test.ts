// Approving a file proposal never replaces what the user didn't see: the proposals on a real store and a temp
// workspace, approved after the file changed by hand in each way it can. Only the text of the version approved is
// ever written, and only onto the file that version was made from.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProposalDetail } from "@wombat/shared/proposals";
import { expect, onTestFinished, test } from "vitest";

import { createProposals } from "../src/proposals/proposals.ts";
import { open, tempStorePath } from "./store-fixtures.ts";

type Notes = { setup: string; rotation: string; review: string };

const notes = ({ setup, rotation, review }: Notes) => `# Pairing notes\n\n## Setup\n\n${setup}\n\n## Rotation\n\n- ${rotation}\n- The navigator keeps the notes.\n\n## Review\n\n${review}\n`;

const BASE: Notes = {
  setup: "Run `./seed.sh` before the first session.",
  rotation: "Driver and navigator swap every half hour.",
  review: "Open one pull request per finished test.",
};
const EDITS = [{ oldText: "swap every half hour", newText: "swap after each finished test" }];
const PROPOSED: Notes = { ...BASE, rotation: "Driver and navigator swap after each finished test." };
/** A hand edit in a section the proposal doesn't touch, and one to the line its edit matched. */
const ELSEWHERE: Notes = { ...BASE, review: "Open one pull request per pairing day." };
const SAME_LINE: Notes = { ...BASE, rotation: "Driver and navigator swap every twenty minutes." };

const LIMITS = '{ "maxFiles": 12 }';
const AGENT = "agent-1";

const bench = () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "wombat-file-approve-")));
  onTestFinished(() => rmSync(workspace, { recursive: true, force: true }));
  const store = open({ path: tempStorePath() });
  const proposals = createProposals({ store, workspace, agentFolder: () => workspace, onProposal: () => undefined, log: () => undefined });
  const path = join(workspace, "pairing-notes.md");
  const text = async (id: string) => ((await proposals.get(id)) as Extract<ProposalDetail, { target: "file" }>).text;
  return {
    store,
    proposals,
    path,
    text,
    /** Writes the notes and proposes EDITS on them. */
    proposeEdit: async () => {
      writeFileSync(path, notes(BASE));
      return (await proposals.proposeFile(AGENT, path, "The rotation rule changed.", { edits: EDITS })).proposed;
    },
    proposeCreate: async (file: string) => (await proposals.proposeFile(AGENT, file, "The limits need a file of their own.", { content: LIMITS })).proposed,
  };
};

const read = (path: string) => readFileSync(path, "utf8");

test("approving the current version writes exactly its text", async () => {
  const { proposals, path, proposeEdit } = bench();
  const id = await proposeEdit();

  expect(await proposals.approve(id, 1)).toMatchObject({ status: "approved" });

  expect(read(path)).toBe(notes(PROPOSED));
});

test("after a hand edit elsewhere in the file, approving writes nothing and leaves a new version with both changes, which then approves", async () => {
  const { proposals, path, text, store, proposeEdit } = bench();
  const id = await proposeEdit();
  writeFileSync(path, notes(ELSEWHERE));

  const first = await proposals.approve(id, 1);

  expect(read(path), "nothing was written").toBe(notes(ELSEWHERE));
  expect(first.status).toBe("pending");
  expect(first.version, "a new, higher version").toBeGreaterThan(1);
  expect(store.listVersions(id).at(-1)?.by).toBe("agent");
  const both = notes({ ...ELSEWHERE, rotation: PROPOSED.rotation });
  expect(await text(id)).toBe(both);

  // The version approved before isn't the current one anymore: what it held must not be written.
  await expect(proposals.approve(id, 1)).rejects.toMatchObject({ code: "proposal_changed" });
  expect(read(path)).toBe(notes(ELSEWHERE));

  expect(await proposals.approve(id, first.version)).toMatchObject({ status: "approved" });
  expect(read(path)).toBe(both);
});

test("after a hand edit to the lines the proposal changes, approving ends in a conflict with nothing written", async () => {
  const { proposals, path, proposeEdit } = bench();
  const id = await proposeEdit();
  writeFileSync(path, notes(SAME_LINE));

  const answer = await proposals.approve(id, 1);

  expect(answer.status).toBe("conflict");
  expect(answer.problem?.message).toBeTruthy();
  expect(read(path)).toBe(notes(SAME_LINE));
});

test.each([
  { what: "a file", make: (path: string) => writeFileSync(path, "written by hand\n"), now: (path: string) => read(path) },
  // Nothing can be read through it, so only the create-only write keeps it from being replaced.
  { what: "a link to a file that isn't there yet", make: (path: string) => symlinkSync("limits.local.json", path), now: (path: string) => readlinkSync(path) },
])("a proposed new file where $what was made meanwhile ends in a conflict, and what was made is untouched", async ({ make, now }) => {
  const { proposals, path, proposeCreate } = bench();
  const file = join(path, "..", "limits.json");
  const id = await proposeCreate(file);
  make(file);
  const made = now(file);

  const answer = await proposals.approve(id, 1);

  expect(answer.status).toBe("conflict");
  expect(now(file)).toBe(made);
  expect(existsSync(join(path, "..", "limits.local.json")), "nothing was written through the link").toBe(false);
});

test("a read-only file stays as it is with the proposal still pending, and approves once it's writable", async () => {
  const { proposals, path, proposeEdit } = bench();
  const id = await proposeEdit();
  chmodSync(path, 0o444);

  const refused = await proposals.approve(id, 1);

  expect(refused).toMatchObject({ status: "pending", version: 1 });
  expect(refused.problem?.message).toBeTruthy();
  expect(read(path)).toBe(notes(BASE));

  chmodSync(path, 0o644);
  expect(await proposals.approve(id, 1)).toMatchObject({ status: "approved" });
  expect(read(path)).toBe(notes(PROPOSED));
});
