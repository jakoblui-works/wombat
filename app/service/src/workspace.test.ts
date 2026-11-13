// An agent never starts outside the workspace. A repo path resolves to its
// real path under the workspace root, or is rejected; symlinks can't lead out.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import fc from "fast-check";
import { expect, test } from "vitest";

import { resolveRepo } from "./workspace.ts";

// The workspace is `ws`; `ws-evil` shares its name as a prefix, to catch a plain string-prefix check.
const PLACES = ["ws", "outside", "ws-evil"] as const;
type Place = (typeof PLACES)[number];

const name = fc.constantFrom("a", "b", "c");
const segments = (minLength: number) => fc.array(name, { minLength, maxLength: 2 });

type Entry =
  | { kind: "dir"; place: Place; path: string[] }
  | { kind: "file"; path: string[] }
  | { kind: "link"; at: string[]; place: Place; target: string[]; relative: boolean };

const entry: fc.Arbitrary<Entry> = fc.oneof(
  fc.record({ kind: fc.constant("dir" as const), place: fc.constantFrom(...PLACES), path: segments(1) }),
  fc.record({ kind: fc.constant("file" as const), path: segments(1) }),
  fc.record({
    kind: fc.constant("link" as const),
    at: segments(1),
    place: fc.constantFrom(...PLACES),
    target: segments(0),
    relative: fc.boolean(),
  }),
);

const tryTo = (make: () => void) => {
  try {
    make();
  } catch {
    // The path is taken already (or its parent is a file): the tree just doesn't get this entry.
  }
};

const build = (base: string, entries: Entry[]) => {
  for (const place of PLACES) mkdirSync(join(base, place));
  for (const item of entries) {
    if (item.kind === "dir") {
      tryTo(() => mkdirSync(join(base, item.place, ...item.path), { recursive: true }));
    } else if (item.kind === "file") {
      const path = join(base, "ws", ...item.path);
      tryTo(() => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "not a directory");
      });
    } else {
      const at = join(base, "ws", ...item.at);
      const target = join(base, item.place, ...item.target);
      tryTo(() => {
        mkdirSync(dirname(at), { recursive: true });
        symlinkSync(item.relative ? relative(dirname(at), target) || "." : target, at);
      });
    }
  }
};

/** What should happen to `repo`, worked out from the real file system. */
const expected = (root: string, repo: string) => {
  let real: string;
  try {
    real = realpathSync(join(root, repo));
  } catch {
    return { rejected: ["repo_not_found", "repo_outside_workspace"] };
  }
  const rootReal = realpathSync(root);
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return { rejected: ["repo_outside_workspace"] };
  if (!statSync(real).isDirectory()) return { rejected: ["repo_not_found"] };
  return { resolved: real };
};

const errorCode = (call: () => unknown) => {
  try {
    call();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  return undefined;
};

test("a repo resolves to its real path under the workspace root, or is rejected: symlinks never lead out", () => {
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 8 }), (entries) => {
      const base = mkdtempSync(join(tmpdir(), "wombat-workspace-"));
      try {
        build(base, entries);
        const root = join(base, "ws");
        const candidates = new Set(["."]);
        for (const item of entries) {
          const path = item.kind === "link" ? item.at : item.kind === "dir" && item.place === "ws" ? item.path : item.kind === "file" ? item.path : [];
          for (let length = 1; length <= path.length; length += 1) candidates.add(path.slice(0, length).join("/"));
          if (path.length > 0) candidates.add([...path, "a"].join("/"));
        }

        for (const repo of candidates) {
          const outcome = expected(root, repo);
          if ("resolved" in outcome) {
            expect(resolveRepo(root, repo), repo).toBe(outcome.resolved);
          } else {
            expect(outcome.rejected, `${repo} must be rejected`).toContain(errorCode(() => resolveRepo(root, repo)));
          }
        }
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }),
    { numRuns: 100 },
  );
});
