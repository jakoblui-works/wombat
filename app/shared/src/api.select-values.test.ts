// A select's values come from one place, flat or grouped, in the agent's order.
import { expect, test } from "vitest";

import { selectGroups, selectValues } from "./api.ts";

const flat = { options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] };
const grouped = {
  options: [
    { group: "g1", name: "One", options: [{ value: "a", name: "A" }] },
    { group: "g2", name: "Two", options: [{ value: "b", name: "B" }, { value: "c", name: "C" }] },
  ],
};

test("a flat select's values are its options, with no groups", () => {
  expect(selectValues(flat).map(({ value }) => value)).toEqual(["a", "b"]);
  expect(selectGroups(flat)).toBeUndefined();
});

test("a grouped select's values are its groups' values in order, and its groups are kept", () => {
  expect(selectValues(grouped).map(({ value }) => value)).toEqual(["a", "b", "c"]);
  expect(selectGroups(grouped)?.map(({ group }) => group)).toEqual(["g1", "g2"]);
});
