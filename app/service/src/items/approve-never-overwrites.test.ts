// Lasting check (silent failure): approving never overwrites. A proposal applies only to the item as the agent
// read it and under the structure's settings as they are now: when the file changed (edited, its handle changed,
// or deleted by hand) or the settings changed (the structure became read or hidden, the field became locked),
// approving marks the proposal `conflict` with a problem and leaves every file as it is. A proposal sent with a
// version older than the file is refused at once and stores nothing.
import { rmSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { Access } from "./access.ts";
import { AGENT, expectRefused, openAccessRoot, snapshotFiles } from "../../test/access-fixtures.ts";
import { readAt, writeAt } from "../../test/items-fixtures.ts";

const BUG = "bugs/BUG-2-hero-caption.md";

const HAND_CHANGES: { what: string; change: (root: string) => void }[] = [
  { what: "the item was edited by hand", change: (root) => writeAt(root, BUG, `${readAt(root, BUG)}\nAlso seen in Chromium.\n`) },
  {
    what: "its handle was changed by hand",
    change: (root) => writeAt(root, BUG, readAt(root, BUG).replace("handle: BUG-2\n", "handle: BUG-20\naliases: [BUG-2]\n")),
  },
  { what: "the item was deleted by hand", change: (root) => rmSync(join(root, BUG)) },
  {
    what: "the structure became read",
    // A read structure can't have locks, so they go too.
    change: (root) =>
      writeAt(root, "bugs/_structure.yaml", readAt(root, "bugs/_structure.yaml").replace("access: propose", "access: read").replace("locked: [repo, body]\n", "")),
  },
  {
    what: "the structure became hidden",
    change: (root) =>
      writeAt(root, "bugs/_structure.yaml", readAt(root, "bugs/_structure.yaml").replace("access: propose", "access: hidden").replace("locked: [repo, body]\n", "")),
  },
  {
    what: "the field became locked",
    change: (root) => writeAt(root, "bugs/_structure.yaml", readAt(root, "bugs/_structure.yaml").replace("locked: [repo, body]", "locked: [repo, body, note]")),
  },
];

describe("approve never overwrites", () => {
  test.each(HAND_CHANGES)("approving an update after $what marks it conflict and changes no file", async ({ change }) => {
    const { access, root } = openAccessRoot();
    const { version } = await access.get("BUG-2");
    const { proposed } = await access.proposeUpdate(AGENT, "BUG-2", { note: "Overlap fixed by the new layout" }, version, "Seen again");
    change(root);
    const before = snapshotFiles(root);

    const decided = await access.approve(proposed);

    expect(decided.status).toBe("conflict");
    expect(decided.problem?.message.trim().length, "the problem says what changed").toBeGreaterThan(0);
    expect(snapshotFiles(root)).toEqual(before);
  });

  test("approving a delete after the item was edited by hand marks it conflict and keeps the file", async () => {
    const { access, root } = openAccessRoot();
    const { version } = await access.get("BUG-2");
    const { proposed } = await access.proposeDelete(AGENT, "BUG-2", version, "A duplicate");
    writeAt(root, BUG, `${readAt(root, BUG)}\nNot a duplicate after all.\n`);
    const before = snapshotFiles(root);

    const decided = await access.approve(proposed);

    expect(decided.status).toBe("conflict");
    expect(snapshotFiles(root)).toEqual(before);
  });

  test("control: approving with nothing changed applies the update", async () => {
    const { access, root } = openAccessRoot();
    const { version } = await access.get("BUG-2");
    const { proposed } = await access.proposeUpdate(AGENT, "BUG-2", { note: "Overlap fixed" }, version, "Seen again");

    const decided = await access.approve(proposed);

    expect(decided.status).toBe("approved");
    expect(readAt(root, BUG)).toContain("note: Overlap fixed");
  });

  test.each([
    { what: "propose_update", call: (a: Access, v: string) => a.proposeUpdate(AGENT, "BUG-2", { note: "x" }, v, "why") },
    { what: "propose_delete", call: (a: Access, v: string) => a.proposeDelete(AGENT, "BUG-2", v, "why") },
  ])("$what sent with a version older than the file is refused and stores nothing", async ({ what, call }) => {
    const { access, root } = openAccessRoot();
    const { version } = await access.get("BUG-2");
    writeAt(root, BUG, `${readAt(root, BUG)}\nEdited by hand after the agent read it.\n`);

    await expectRefused(call(access, version), "stale_version", what);

    expect(await access.proposals()).toEqual([]);
  });
});
