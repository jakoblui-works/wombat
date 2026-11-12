// S7 T13 (silent failure): the button the user reads as Approve grants the narrowest allow on offer, and Reject the
// narrowest reject: Approve is allow_once, else the first allow_*; Reject is reject_once, else the first reject_*.
// Every other option is a secondary button, ordered by name; no option is lost or shown twice.
import fc from "fast-check";
import { expect, test } from "vitest";

import { type PermissionOption, permissionButtons } from "./permission-buttons.ts";

const KINDS = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;
const NAMES = ["Allow", "Always allow", "Reject", "Never", "Allow for this file", "Skip", "Deny"] as const;

const option: fc.Arbitrary<PermissionOption> = fc.record({ kind: fc.constantFrom(...KINDS), name: fc.constantFrom(...NAMES) });

const preferred = (options: readonly PermissionOption[], once: string, prefix: string): PermissionOption | undefined =>
  options.find(({ kind }) => kind === once) ?? options.find(({ kind }) => kind.startsWith(prefix));

test("Approve and Reject are the narrowest on offer, the rest follow by name, each option exactly once", () => {
  fc.assert(
    fc.property(fc.array(option, { maxLength: 6 }), (options) => {
      const { approve, reject, others } = permissionButtons(options);

      expect(approve).toBe(preferred(options, "allow_once", "allow_"));
      expect(reject).toBe(preferred(options, "reject_once", "reject_"));

      // Every option once: the same objects, none dropped or doubled.
      const shown = [approve, reject, ...others].filter((item) => item !== undefined);
      expect(shown).toHaveLength(options.length);
      expect(new Set(shown).size).toBe(options.length);
      for (const item of options) expect(shown).toContain(item);

      // By name: either a locale or a code-point order (they agree on these names; neither is pinned).
      const names = others.map(({ name }) => name);
      const byLocale = [...names].sort((a, b) => a.localeCompare(b));
      const byCodePoint = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect([byLocale, byCodePoint]).toContainEqual(names);
    }),
  );
});

test("an allow_always listed before allow_once never becomes Approve", () => {
  const always = { kind: "allow_always", name: "Always allow" } as const;
  const once = { kind: "allow_once", name: "Allow" } as const;
  const rejectAlways = { kind: "reject_always", name: "Never" } as const;
  const rejectOnce = { kind: "reject_once", name: "Reject" } as const;
  const { approve, reject, others } = permissionButtons([always, rejectAlways, once, rejectOnce]);
  expect(approve).toBe(once);
  expect(reject).toBe(rejectOnce);
  expect(others).toEqual([always, rejectAlways]);
});
