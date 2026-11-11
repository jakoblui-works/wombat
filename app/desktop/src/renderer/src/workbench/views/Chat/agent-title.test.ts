import { expect, test } from "vitest";

import { agentTitle } from "./chat-params.ts";

test("the display title is the title, else the repo, else the start of the id", () => {
  expect(agentTitle("abcdefghijkl", { title: "Fix totals", repo: "shop" })).toBe("Fix totals");
  expect(agentTitle("abcdefghijkl", { repo: "shop" })).toBe("shop");
  expect(agentTitle("abcdefghijkl", undefined)).toBe("abcdefgh");
});
