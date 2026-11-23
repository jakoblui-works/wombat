// The composer bar offers the service's repo list for the chosen workspace. While that list is unread, or its read
// failed (a workspace whose folder is gone), it offers the workspace root alone, named after the workspace, so a start
// there still reaches the service and gets its answer instead of a Send that does nothing. No workspace, nothing.
import { expect, test } from "vitest";

import { repoChoices } from "./bar-picks.ts";

const workspace = { name: "bakery" };

test("the listed repos as given; unread or failed, the workspace root under the workspace's name; no workspace, none", () => {
  const listed = [
    { path: ".", name: "bakery" },
    { path: "menu-api", name: "menu-api" },
  ];
  expect(repoChoices(listed, workspace)).toEqual(listed);

  expect(repoChoices(undefined, workspace)).toEqual([{ path: ".", name: "bakery" }]);

  expect(repoChoices(undefined, undefined)).toEqual([]);
  expect(repoChoices(listed, undefined)).toEqual([]);
});
