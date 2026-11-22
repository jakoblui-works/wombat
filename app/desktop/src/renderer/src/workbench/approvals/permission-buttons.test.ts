// The button the user reads as Approve grants the narrowest allow on offer.
import { expect, test } from "vitest";

import { permissionButtons } from "./permission-buttons.ts";

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
