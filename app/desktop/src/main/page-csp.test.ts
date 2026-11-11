import { expect, test } from "vitest";

import { newNonce, pageCsp } from "./page-csp.ts";

const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );

const DEV = { scriptHashes: ["sha256-cmVmcmVzaA=="], hmrSocket: "ws://localhost:5173" };

test("the built app's policy has the nonce for <style> elements and no dev sources", () => {
  const nonce = newNonce();
  const built = directives(pageCsp(nonce));
  expect(built.get("style-src-elem")).toEqual(["'self'", `'nonce-${nonce}'`]);
  expect(built.get("script-src")).toEqual(["'self'"]);
  expect(built.get("connect-src")).toEqual(["'none'"]);
  expect(pageCsp(nonce)).not.toContain("sha256-");
  expect(pageCsp(nonce)).not.toContain("ws:");
});

test("the dev policy adds only the refresh preamble's hash and the HMR socket", () => {
  const nonce = newNonce();
  const built = directives(pageCsp(nonce));
  const dev = directives(pageCsp(nonce, DEV));
  expect(dev.get("script-src")).toEqual(["'self'", "'sha256-cmVmcmVzaA=='"]);
  expect(dev.get("connect-src")).toEqual(["ws://localhost:5173"]);
  for (const name of ["script-src", "connect-src"]) {
    built.delete(name);
    dev.delete(name);
  }
  expect(dev).toEqual(built);
});

test("each nonce is fresh and 128 bits", () => {
  const nonces = new Set(Array.from({ length: 50 }, newNonce));
  expect(nonces.size).toBe(50);
  for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
});
