// Approving a file proposal never replaces what the user didn't see: the proposals on a real store and a temp
// workspace, approved after the file changed by hand in each way it can. Only the text of the version approved is
// ever written, and only onto the file that version was made from, also after the agent revised the proposal. Nor
// does it write anywhere else than the user saw: not where the path leads once a folder on it became a symlink, and
// not onto a file that became the items' since.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProposalDetail } from "@wombat/shared/proposals";
import { expect, onTestFinished, test } from "vitest";

import { createProposals } from "../src/proposals/proposals.ts";
import { ACCESS_FILES, openAccessRoot } from "./access-fixtures.ts";
import { writeAt } from "./items-fixtures.ts";
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

/** A fresh temp folder by its real path, removed after the test. */
const tempFolder = () => {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "wombat-file-approve-")));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
};

const bench = () => {
  const workspace = tempFolder();
  const store = open({ path: tempStorePath() });
  const proposals = createProposals({ store, workspace, agentFolder: () => workspace, onProposal: () => undefined, log: () => undefined });
  const path = join(workspace, "pairing-notes.md");
  const text = async (id: string) => ((await proposals.get(id)) as Extract<ProposalDetail, { target: "file" }>).text;
  return {
    store,
    proposals,
    workspace,
    path,
    text,
    /** Writes the notes (at `file`, else at `path`) and proposes EDITS on them. */
    proposeEdit: async (file = path) => {
      writeFileSync(file, notes(BASE));
      return (await proposals.proposeFile(AGENT, file, "The rotation rule changed.", { edits: EDITS })).proposed;
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

// A revise of a pending proposal that took the file as it is now for its base would let approve write the proposed
// text over the hand edit; only a conflict's revise is rebuilt on the file, and says so.
test("a revise after a hand edit elsewhere keeps the proposal's base, so approving never writes text without the hand edit; a conflict's revise is rebuilt on the file", async () => {
  const { proposals, path, text, proposeEdit } = bench();
  const id = await proposeEdit();
  writeFileSync(path, notes(ELSEWHERE));
  // The old text is only in the proposed version: the file still says "every half hour".
  const slower = { oldText: "after each finished test", newText: "after every second finished test" };

  const revised = await proposals.revise(AGENT, id, "Slower.", { edits: [slower] });

  expect(revised, "a pending proposal's revise isn't rebuilt").toEqual({ revised: id, version: revised.version });
  const first = await proposals.approve(id, revised.version);
  expect(read(path), "nothing was written").toBe(notes(ELSEWHERE));
  expect(first.status).toBe("pending");
  const both = notes({ ...ELSEWHERE, rotation: "Driver and navigator swap after every second finished test." });
  expect(await text(id), "the hand edit with both of the agent's edits").toBe(both);
  expect(await proposals.approve(id, first.version)).toMatchObject({ status: "approved" });
  expect(read(path)).toBe(both);

  // A hand edit to the line the proposal changes: a conflict, whose revise works on the file as it is now.
  const conflicted = await proposeEdit();
  writeFileSync(path, notes(SAME_LINE));
  expect(await proposals.approve(conflicted, 1)).toMatchObject({ status: "conflict" });

  const rebuilt = await proposals.revise(AGENT, conflicted, "Kept your twenty minutes.", { edits: [{ oldText: "every twenty minutes", newText: "every twenty minutes, or after each finished test" }] });

  expect(rebuilt).toMatchObject({ revised: conflicted, rebuilt: true });
  expect(read(path), "a revise writes nothing").toBe(notes(SAME_LINE));
  expect(await proposals.approve(conflicted, rebuilt.version)).toMatchObject({ status: "approved" });
  expect(read(path)).toBe(notes({ ...SAME_LINE, rotation: "Driver and navigator swap every twenty minutes, or after each finished test." }));
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

// The path was resolved when the agent proposed; what it leads to now is the agent's to change (its folder, a link in
// it), so an approve that followed it would write wherever the agent points it.
test.each([
  { what: "an edit, to a folder outside the workspace holding the same file", kind: "edit", inWorkspace: false },
  { what: "an edit, to another folder of the workspace holding the same file", kind: "edit", inWorkspace: true },
  { what: "a new file, to a folder outside the workspace", kind: "create", inWorkspace: false },
])("after the folder of a proposal's file was swapped for a symlink ($what), approving ends in a conflict and writes nothing there", async ({ kind, inWorkspace }) => {
  const { proposals, workspace, proposeEdit, proposeCreate } = bench();
  const docs = join(workspace, "docs");
  mkdirSync(docs);
  const elsewhere = inWorkspace ? join(workspace, "handbook") : tempFolder();
  mkdirSync(elsewhere, { recursive: true });
  const id = kind === "edit" ? await proposeEdit(join(docs, "pairing-notes.md")) : await proposeCreate(join(docs, "limits.json"));
  // Byte for byte the file the proposal was made on, so only where it is tells them apart.
  if (kind === "edit") writeFileSync(join(elsewhere, "pairing-notes.md"), notes(BASE));
  const held = () => Object.fromEntries(readdirSync(elsewhere).map((name) => [name, read(join(elsewhere, name))]));
  const before = held();
  renameSync(docs, join(workspace, "docs-before"));
  symlinkSync(elsewhere, docs);

  const answer = await proposals.approve(id, 1);

  expect(answer.status).toBe("conflict");
  expect(answer.problem?.message).toBeTruthy();
  expect(held(), "nothing written where the path leads now").toEqual(before);
});

test("a proposal on a plain file that became an item's file since ends in a conflict when approved, with nothing written", async () => {
  const { proposals, root } = openAccessRoot({ ...ACCESS_FILES, "handbook/pairing-notes.md": notes(BASE) });
  const file = join(root, "handbook", "pairing-notes.md");
  const id = (await proposals.proposeFile(AGENT, file, "The rotation rule changed.", { edits: EDITS })).proposed;
  // By hand the folder becomes a structure's, which reads every .md file in it as an item.
  writeAt(root, "handbook/_structure.yaml", "version: 1\nid: handbook\nname: Handbook\nprefix: HB\naccess: edit\n");

  const answer = await proposals.approve(id, 1);

  expect(answer.status).toBe("conflict");
  expect(answer.problem?.message).toBeTruthy();
  expect(read(file)).toBe(notes(BASE));
});
