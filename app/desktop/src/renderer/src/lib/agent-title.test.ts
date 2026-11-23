// One name for an agent everywhere it's listed: its title; untitled, its folder's path, or for an agent at the
// workspace root the name of its own workspace (looked up in the workspace list); never a bare "." while that list is
// unread or doesn't hold the workspace. (How the root is named is the service's `listRepos` test's; this one checks
// that the title finds the agent's workspace.)
import { expect, test } from "vitest";

import { agentTitle } from "./agent-title.ts";

const workspaces = [
  { id: "ws-bakery0001", name: "bakery" },
  { id: "ws-orchard001", name: "orchard" },
];

test("a title wins; untitled, a folder agent by its path and a root agent by its own workspace's name", () => {
  expect(agentTitle("agt_7f3a9c01", { title: "Tidy the opening hours", repo: ".", workspace: "ws-orchard001" }, workspaces)).toBe("Tidy the opening hours");
  expect(agentTitle("agt_7f3a9c01", { repo: "menu-api", workspace: "ws-orchard001" }, workspaces)).toBe("menu-api");
  expect(agentTitle("agt_7f3a9c01", { repo: ".", workspace: "ws-orchard001" }, workspaces)).toBe("orchard");
  expect(agentTitle("agt_7f3a9c01", { repo: ".", workspace: "ws-bakery0001" }, workspaces)).toBe("bakery");

  for (const list of [undefined, [], workspaces.slice(0, 1)]) expect(agentTitle("agt_7f3a9c01", { repo: ".", workspace: "ws-orchard001" }, list)).not.toBe(".");
});
