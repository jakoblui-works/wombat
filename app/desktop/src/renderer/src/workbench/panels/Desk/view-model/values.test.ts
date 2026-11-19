// A link value shows as its target's handle, or as the missing-item text when the target is gone, whether or not the
// property is known as a link (an invalid item's value, a property a newer service sends).
import { describe, expect, test } from "vitest";

import type { LenientProperty } from "@wombat/shared/items";

import { displayValue, MISSING_ITEM } from "./values.ts";

const LINK: LenientProperty = { type: "link", to: "backlog", required: false };
const TARGET_ID = "0196f3c2-0000-7000-8000-000000000002";

describe("displayValue", () => {
  test.each([
    { what: "a link property's value", property: LINK, handle: "BL-2", shows: "BL-2" },
    { what: "an undeclared property's link value", property: undefined, handle: "BL-2", shows: "BL-2" },
    { what: "a link property's value whose target is gone", property: LINK, handle: null, shows: MISSING_ITEM },
    { what: "an undeclared property's link value whose target is gone", property: undefined, handle: null, shows: MISSING_ITEM },
  ])("$what", ({ property, handle, shows }) => {
    expect(displayValue(property, { id: TARGET_ID, handle })).toBe(shows);
  });
});
