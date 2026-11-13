import { expect, test } from "vitest";

import { newNonce, pageCsp } from "./page-csp.ts";

const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );

test("the built app's policy has the nonce for <style> elements and no dev sources", () => {
  const nonce = newNonce();
  const built = directives(pageCsp(nonce));
  expect(built.get("style-src-elem")).toEqual(["'self'", `'nonce-${nonce}'`]);
  expect(built.get("script-src")).toEqual(["'self'"]);
  expect(built.get("connect-src")).toEqual(["'none'"]);
  expect(pageCsp(nonce)).not.toContain("sha256-");
  expect(pageCsp(nonce)).not.toContain("ws:");
});
