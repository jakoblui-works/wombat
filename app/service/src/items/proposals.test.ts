// Proposals from store to decision: a propose_* call stores a pending proposal with the agent, the fields, the
// reason and the version it's based on; approving applies it through the writer (a create gets its handle),
// rejecting touches no file, and a decided proposal can't be decided again. Proposing writes no file and takes no
// handle number (nor may the writer's dry run), so an approved create gets the handle it would get alone. A
// free-named create keeps its path in the proposal's own `file` (null for every other proposal), never in `fields`,
// and approving writes exactly there, even in a structure with a property named `file`.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { openAccess, type Access } from "./access.ts";
import { ACCESS_FILES, AGENT, expectRefused, openAccessRoot, snapshotFiles } from "../../test/access-fixtures.ts";
import { openItems, readAt, writeRoot } from "../../test/items-fixtures.ts";

const BUG = "bugs/BUG-2-hero-caption.md";

/** Free-named structures taking proposals: `drafts`, and `papers`, which has a property named `file`. */
const FREE_FILES = {
  ...ACCESS_FILES,
  "drafts/_structure.yaml": 'version: 1\nid: drafts\nname: Drafts\nprefix: DRF\naccess: propose\nnaming: free\ninclude: ["**/*.md"]\n',
  "drafts/guides/keep.md": "---\nid: 0196f3c2-9e00-7000-8000-0000000000b1\nhandle: DRF-1\n---\n# Keep\n\nInvented.\n",
  "papers/_structure.yaml":
    'version: 1\nid: papers\nname: Papers\nprefix: PAP\naccess: propose\nnaming: free\ninclude: ["**/*.md"]\nproperties:\n  file: { type: text }\n',
};

describe("proposals", () => {
  test("propose_update stores a pending proposal with the agent, fields, reason and base version, and announces it", async () => {
    const { access, announced } = openAccessRoot();
    const { version } = await access.get("BUG-2");

    const { proposed } = await access.proposeUpdate(AGENT, "BUG-2", { note: "Seen again" }, version, "Reported twice");

    const [proposal] = await access.proposals("pending");
    expect(proposal).toMatchObject({
      id: proposed,
      structure: "bugs",
      kind: "update",
      handle: "BUG-2",
      fields: { note: "Seen again" },
      reason: "Reported twice",
      baseVersion: version,
      status: "pending",
      agentId: AGENT,
    });
    expect(proposal?.decidedAt).toBeUndefined();
    expect(announced).toEqual([proposed]);
  });

  test("a proposal writes nothing and takes no handle number: the approved create gets the handle it would get alone", async () => {
    const drafts = "version: 1\nid: drafts\nname: Drafts\nprefix: DRF\naccess: propose\nnaming: free\ninclude: [\"**/*.md\"]\n";
    const files = { ...ACCESS_FILES, "drafts/_structure.yaml": drafts };
    const footer = { title: "The footer link is broken", properties: { note: "On every page" } };

    /** Approves one bug proposal after `before` ran on the same root, and returns the handle it got. */
    const approvedAfter = async (before: (access: Access) => Promise<void>) => {
      const { access, root } = openAccessRoot(files);
      await access.list("bugs");
      const untouched = snapshotFiles(root);
      await before(access);
      expect(snapshotFiles(root), "files after the proposals before the approval").toEqual(untouched);
      const { proposed } = await access.proposeCreate(AGENT, "bugs", footer, "Found it");
      expect(snapshotFiles(root), "files after the proposal to approve").toEqual(untouched);
      return (await access.approve(proposed)).handle;
    };

    const alone = await approvedAfter(() => Promise.resolve());
    const afterOthers = await approvedAfter(async (access) => {
      // Stored ones, handle-named and free-named, and refused ones.
      await access.proposeCreate(AGENT, "bugs", { title: "The menu flickers" }, "Seen on a phone");
      await access.proposeCreate(AGENT, "bugs", { title: "The menu flickers again" }, "Seen twice");
      await access.proposeCreate(AGENT, "drafts", { title: "A draft", body: "\nInvented.\n", file: "a-draft.md" }, "For the docs");
      await expectRefused(access.proposeCreate(AGENT, "bugs", { title: "" }, "Untitled"), "invalid_fields", "an empty title");
      await expectRefused(access.proposeCreate(AGENT, "bugs", { title: "Stray", properties: { stray: "x" } }, "Stray"), "invalid_fields", "an undeclared property");
      expect(await access.proposals("pending"), "three proposals stored").toHaveLength(3);
    });

    expect(alone, "a handle").not.toBeNull();
    expect(afterOthers, "the handle after other proposals").toBe(alone);
  });

  test("a free-named create keeps its path in the proposal's file, not in fields, and approving writes exactly there", async () => {
    const { access, root } = openAccessRoot(FREE_FILES);
    await access.list("drafts");
    const before = Object.keys(snapshotFiles(root));

    const { proposed } = await access.proposeCreate(AGENT, "drafts", { title: "Setting up", body: "\nInvented.\n", file: "guides/setup.md" }, "For new people");

    const [pending] = await access.proposals("pending");
    expect(pending?.file, "the proposal's file").toBe("guides/setup.md");
    expect(pending?.fields, "fields holds title, body and properties only").not.toHaveProperty("file");
    const decided = await access.approve(proposed);
    expect(decided.status).toBe("approved");
    expect(decided.file, "the decided proposal's file").toBe("guides/setup.md");
    const added = Object.keys(snapshotFiles(root)).filter((path) => !before.includes(path));
    expect(added, "the one file written").toEqual(["drafts/guides/setup.md"]);
    expect(readAt(root, "drafts/guides/setup.md")).toContain("# Setting up");
  });

  test("approving an update writes the field, and approving a delete removes the file", async () => {
    const { access, root } = openAccessRoot();
    const update = await access.proposeUpdate(AGENT, "BUG-2", { note: "Fixed by the grid" }, (await access.get("BUG-2")).version, "Done");
    expect((await access.approve(update.proposed)).status).toBe("approved");
    expect(readAt(root, BUG)).toContain("note: Fixed by the grid");

    const removal = await access.proposeDelete(AGENT, "BUG-2", (await access.get("BUG-2")).version, "A duplicate");
    expect((await access.approve(removal.proposed)).status).toBe("approved");
    expect(existsSync(join(root, BUG))).toBe(false);
  });

  test("rejecting marks the proposal rejected and touches no file", async () => {
    const { access, root, announced } = openAccessRoot();
    const { proposed } = await access.proposeDelete(AGENT, "BUG-2", (await access.get("BUG-2")).version, "A duplicate");
    const before = snapshotFiles(root);

    const decided = await access.reject(proposed);

    expect(decided.status).toBe("rejected");
    expect(decided.decidedAt).toBeDefined();
    expect(snapshotFiles(root)).toEqual(before);
    expect(announced).toEqual([proposed, proposed]);
  });

  test("a proposal stays stored and answered when announcing it fails", async () => {
    const opened = openItems(writeRoot(ACCESS_FILES));
    const logged: string[] = [];
    const access = openAccess({
      ...opened,
      onProposal: () => {
        throw new Error("listener broke");
      },
      log: (event) => logged.push(event),
    });

    const { proposed } = await access.proposeUpdate(AGENT, "BUG-2", { note: "Still seen" }, (await access.get("BUG-2")).version, "Why");

    expect((await access.proposals()).map((proposal) => proposal.id)).toEqual([proposed]);
    expect(logged).toEqual(["proposal_alert_failed"]);
  });
});
