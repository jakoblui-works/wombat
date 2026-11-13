// After a resume the agent answers some settings at their defaults (Claude: model and effort); the ones
// to set again are those whose stored value differs and is still offered, in the stored order.
import { expect, test } from "vitest";

import { type ConfigOption, configToRestore } from "./api.ts";

const select = (id: string, currentValue: string, values: string[]): ConfigOption => ({
  id,
  name: id,
  type: "select",
  currentValue,
  options: values.map((value) => ({ value, name: value })),
});
const grouped = (id: string, currentValue: string, values: string[]): ConfigOption => ({
  id,
  name: id,
  type: "select",
  currentValue,
  options: [{ group: "all", name: "All", options: values.map((value) => ({ value, name: value })) }],
});
const flag = (id: string, currentValue: boolean): ConfigOption => ({ id, name: id, type: "boolean", currentValue });

test("only the differing values the returned options still offer, in the stored order", () => {
  const stored = [
    flag("fast", true),
    select("effort", "high", ["low", "high"]),
    select("mode", "plan", ["ask", "plan"]),
    grouped("model", "large", ["small", "large"]),
    select("gone", "x", ["x", "y"]),
    select("retired", "old", ["old", "new"]),
  ];
  const returned = [
    grouped("model", "small", ["small", "large"]),
    select("mode", "plan", ["ask", "plan"]),
    select("effort", "low", ["low", "high"]),
    flag("fast", false),
    select("retired", "new", ["new"]),
  ];
  expect(configToRestore(stored, returned)).toEqual([
    { id: "fast", value: true },
    { id: "effort", value: "high" },
    { id: "model", value: "large" },
  ]);
});
