import { expect, test } from "vitest";

import { bySeq } from "./by-seq.ts";

test("bySeq sorts by seq and keeps one entry per seq, the later copy", () => {
  const entries = [
    { seq: 3, copy: "first" },
    { seq: 1, copy: "only" },
    { seq: 3, copy: "second" },
    { seq: 2, copy: "only" },
  ];
  expect(bySeq(entries)).toEqual([
    { seq: 1, copy: "only" },
    { seq: 2, copy: "only" },
    { seq: 3, copy: "second" },
  ]);
});
