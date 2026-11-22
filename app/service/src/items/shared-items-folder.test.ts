// Two workspaces on one items folder number its handles from one counter, also when one names the folder through a
// symlink. Otherwise creates through the two take one handle for two items, and a deleted item's handle comes back.
import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { expect, onTestFinished, test } from "vitest";

import { VALID_FILES, writeRoot } from "../../test/items-fixtures.ts";
import { open, tempDir, tempStorePath } from "../../test/store-fixtures.ts";
import { ME } from "./write.ts";
import { openWorkspaceItems } from "./workspace-items.ts";

const idea = (title: string) => ({ title, body: "\nInvented for the test.\n", properties: { project: "wombat" } });

test("two workspaces on one items folder never give one handle to two items, also after the newest is deleted", async () => {
  const itemsRoot = writeRoot(VALID_FILES);
  const linked = join(tempDir(), "items-link");
  symlinkSync(itemsRoot, linked);
  const store = open({ path: tempStorePath() });
  const first = store.addWorkspace(tempDir(), itemsRoot).workspace;
  const second = store.addWorkspace(tempDir(), linked).workspace;
  const items = openWorkspaceItems({ store, log: () => undefined, onChanged: () => undefined });
  onTestFinished(() => items.close());
  await items.open(first);
  await items.open(second);
  const writerOf = (id: string) => {
    const opened = items.of(id);
    if (opened === undefined) throw new Error(`workspace ${id} has no items open`);
    return opened.writer;
  };

  const given: string[] = [];
  for (const [index, title] of ["First idea", "Second idea", "Third idea", "Fourth idea"].entries()) {
    const item = await writerOf(index % 2 === 0 ? first.id : second.id).createItem(ME, "backlog", idea(title));
    given.push(item.handle ?? "");
  }
  expect(new Set(given).size, `handles given: ${given.join(", ")}`).toBe(given.length);

  const newest = await writerOf(second.id).createItem(ME, "backlog", idea("Fifth idea"));
  given.push(newest.handle ?? "");
  await writerOf(second.id).deleteItem(ME, newest.handle ?? "", newest.version);
  const after = await writerOf(first.id).createItem(ME, "backlog", idea("Sixth idea"));
  expect(given, `a new item after ${newest.handle ?? ""} was deleted`).not.toContain(after.handle);
});
