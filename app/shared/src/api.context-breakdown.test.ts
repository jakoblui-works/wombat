// T13 (S2c, row T13-13): a category kind this app doesn't know reads as "used", and the rest of the breakdown still
// parses, so a newer harness never breaks the context dialog.
import { expect, test } from "vitest";

import { SAMPLE_BREAKDOWN } from "../test/context-cases.ts";
import { ContextBreakdown } from "./api.ts";

test("an unknown category kind reads as used, and everything else parses as sent", () => {
  const sent = {
    ...SAMPLE_BREAKDOWN,
    categories: [...SAMPLE_BREAKDOWN.categories, { name: "Reserved for later", tokens: 700, kind: "reserved" }],
  };

  expect(ContextBreakdown.parse(sent)).toEqual({
    ...SAMPLE_BREAKDOWN,
    categories: [...SAMPLE_BREAKDOWN.categories, { name: "Reserved for later", tokens: 700, kind: "used" }],
  });
});
