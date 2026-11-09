// Lasting check (silent failure): levels and locks at the boundary. A write in a `read` structure, a call of the
// wrong family (a direct write in `propose`, a proposal in `edit`), or a change touching a locked field is refused
// with the code that says what to do (naming the tool or the field), and changes no file and stores no proposal.
// A create may set a locked title or body (every item needs them), never a locked property. The MCP layer's half
// is server/mcp-levels.test.ts.
import { describe, expect, test } from "vitest";

import type { Access, AccessErrorCode } from "./access.ts";
import { AGENT, expectRefused, openAccessRoot, snapshotFiles } from "../../test/access-fixtures.ts";

type Case = { what: string; code: AccessErrorCode; names?: string; call: (access: Access, version: (handle: string) => Promise<string>) => Promise<unknown> };

const input = { title: "Invented for the test", body: "\nA body.\n" };

const CASES: Case[] = [
  // read
  { what: "create in read", code: "read_only", call: (a) => a.create(AGENT, "docs", input) },
  { what: "update in read", code: "read_only", call: async (a, v) => a.update(AGENT, "DOC-1", { title: "Changed" }, await v("DOC-1")) },
  { what: "remove in read", code: "read_only", call: async (a, v) => a.remove(AGENT, "DOC-1", await v("DOC-1")) },
  { what: "propose_create in read", code: "read_only", call: (a) => a.proposeCreate(AGENT, "docs", input, "why") },
  { what: "propose_update in read", code: "read_only", call: async (a, v) => a.proposeUpdate(AGENT, "DOC-1", { title: "Changed" }, await v("DOC-1"), "why") },
  { what: "propose_delete in read", code: "read_only", call: async (a, v) => a.proposeDelete(AGENT, "DOC-1", await v("DOC-1"), "why") },
  // propose: direct writes name the propose_* tool
  { what: "create in propose", code: "use_propose", names: "propose_create", call: (a) => a.create(AGENT, "bugs", input) },
  { what: "update in propose", code: "use_propose", names: "propose_update", call: async (a, v) => a.update(AGENT, "BUG-2", { note: "x" }, await v("BUG-2")) },
  { what: "remove in propose", code: "use_propose", names: "propose_delete", call: async (a, v) => a.remove(AGENT, "BUG-2", await v("BUG-2")) },
  // edit: proposals name the direct tool
  { what: "propose_create in edit", code: "use_edit", names: "create_item", call: (a) => a.proposeCreate(AGENT, "backlog", input, "why") },
  { what: "propose_update in edit", code: "use_edit", names: "update_item", call: async (a, v) => a.proposeUpdate(AGENT, "BL-2", { owner: "x" }, await v("BL-2"), "why") },
  { what: "propose_delete in edit", code: "use_edit", names: "delete_item", call: async (a, v) => a.proposeDelete(AGENT, "BL-2", await v("BL-2"), "why") },
  // locks, refused before anything is stored or written
  { what: "propose_update of a locked property", code: "locked", names: "repo", call: async (a, v) => a.proposeUpdate(AGENT, "BUG-2", { repo: "api" }, await v("BUG-2"), "why") },
  { what: "propose_update of a locked body", code: "locked", names: "body", call: async (a, v) => a.proposeUpdate(AGENT, "BUG-2", { body: "\nNew.\n" }, await v("BUG-2"), "why") },
  {
    what: "propose_update of a free and a locked field together",
    code: "locked",
    names: "repo",
    call: async (a, v) => a.proposeUpdate(AGENT, "BUG-2", { note: "fine", repo: "api" }, await v("BUG-2"), "why"),
  },
  { what: "propose_create setting a locked property", code: "locked", names: "repo", call: (a) => a.proposeCreate(AGENT, "bugs", { ...input, properties: { repo: "api" } }, "why") },
  { what: "update of a locked title", code: "locked", names: "title", call: async (a, v) => a.update(AGENT, "BL-2", { title: "Renamed" }, await v("BL-2")) },
  { what: "update of a locked property", code: "locked", names: "project", call: async (a, v) => a.update(AGENT, "BL-2", { owner: "Kim", project: "platform" }, await v("BL-2")) },
  { what: "create setting a locked property", code: "locked", names: "project", call: (a) => a.create(AGENT, "backlog", { ...input, properties: { project: "platform" } }) },
];

describe("levels and locks at the boundary", () => {
  test.each(CASES)("$what is refused ($code), and no file changes and no proposal is stored", async ({ what, code, names, call }) => {
    const { access, root } = openAccessRoot();
    const before = snapshotFiles(root);
    const version = async (handle: string) => (await access.get(handle)).version;

    const message = await expectRefused(call(access, version), code, what);

    if (names !== undefined) expect(message, `${what}: the message names ${names}`).toContain(names);
    expect(snapshotFiles(root)).toEqual(before);
    expect(await access.proposals()).toEqual([]);
  });

  test("a create may set a locked title or body: the item is written, or the proposal stored", async () => {
    const { access, root } = openAccessRoot();

    const written = await access.create(AGENT, "backlog", { title: "A locked title is set on create", body: "\nFine.\n", properties: { owner: "Kim" } });
    const proposed = await access.proposeCreate(AGENT, "bugs", { title: "A locked body is set on create", body: "\nAlso fine.\n" }, "Seen twice");

    expect("written" in written ? written.written : undefined).toMatch(/^BL-\d+$/);
    expect(Object.keys(snapshotFiles(root)).filter((path) => path.startsWith("backlog/"))).toHaveLength(4);
    expect((await access.proposals()).map((proposal) => proposal.id)).toEqual([proposed.proposed]);
  });
});
