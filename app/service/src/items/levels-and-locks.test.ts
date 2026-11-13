// Lasting check (silent failure): levels and locks at the boundary. A write in a `read` structure, a call of the
// wrong family (a direct write in `propose`, a proposal in `edit`), or a change touching a locked field is refused
// with the code that says what to do (naming the tool or the field), and changes no file and stores no proposal.
// A create may set a locked title or body (every item needs them), never a locked property.
import type { AccessErrorCode } from "@wombat/shared/api";
import { describe, expect, test } from "vitest";

import type { Access } from "./access.ts";
import { AGENT, expectRefused, openAccessRoot, snapshotFiles } from "../../test/access-fixtures.ts";

type Case = { what: string; code: AccessErrorCode; names?: string; call: (access: Access, version: (handle: string) => Promise<string>) => Promise<unknown> };

const input = { title: "Invented for the test", body: "\nA body.\n" };

const CASES: Case[] = [
  // read
  { what: "create in read", code: "read_only", call: (a) => a.create(AGENT, "docs", input) },
  { what: "update in read", code: "read_only", call: async (a, v) => a.update(AGENT, "DOC-1", { title: "Changed" }, await v("DOC-1")) },
  { what: "remove in read", code: "read_only", call: async (a, v) => a.remove(AGENT, "DOC-1", await v("DOC-1")) },
  // propose: direct writes name the propose_* tool
  { what: "create in propose", code: "use_propose", names: "propose_create", call: (a) => a.create(AGENT, "bugs", input) },
  { what: "update in propose", code: "use_propose", names: "propose_update", call: async (a, v) => a.update(AGENT, "BUG-2", { note: "x" }, await v("BUG-2")) },
  { what: "remove in propose", code: "use_propose", names: "propose_delete", call: async (a, v) => a.remove(AGENT, "BUG-2", await v("BUG-2")) },
  // edit: proposals name the direct tool
  // locks, refused before anything is stored or written
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
});
