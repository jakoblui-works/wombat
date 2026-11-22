// An item tab's fields follow the binder's settings, not the file: one row per declared property in the settings'
// order, empty ones too; each problem at its property's row, the others (the file's, the title's, an undeclared
// property's) apart.
import { describe, expect, test } from "vitest";

import type { LenientProperty, Problem } from "@wombat/shared/items";

import { propertyRows } from "./property-rows.ts";

const DECLARED: Record<string, LenientProperty> = {
  status: { type: "select", options: ["todo", "doing", "done"], required: true },
  owner: { type: "text", required: false },
  due: { type: "date", required: false },
  parent: { type: "link", to: "tasks", required: false },
};

const STATUS: Problem = { field: "status", message: "status: pick todo, doing or done" };
const UNDECLARED: Problem = { field: "estimate", message: "estimate: not a property of this binder" };
const TITLE: Problem = { field: "title", message: "title: the file needs a # heading" };
const FILE: Problem = { line: 3, message: "The frontmatter doesn't parse." };

describe("propertyRows", () => {
  test("one row per declared property in the settings' order, empty ones too; problems at their field, the rest apart", () => {
    // The file holds its keys in another order, one undeclared, and leaves owner and due out.
    const item = {
      properties: { estimate: 5, parent: { id: "0196f3c2-0000-7000-8000-000000000002", handle: "TSK-2" }, status: "later" },
      problems: [UNDECLARED, STATUS, FILE, TITLE],
    };
    const { rows, rest } = propertyRows(DECLARED, item);
    expect(rows.map(({ name, problems }) => ({ name, problems }))).toEqual([
      { name: "status", problems: [STATUS] },
      { name: "owner", problems: [] },
      { name: "due", problems: [] },
      { name: "parent", problems: [] },
    ]);
    expect(rest.toSorted((a, b) => a.message.localeCompare(b.message))).toEqual([UNDECLARED, TITLE, FILE].toSorted((a, b) => a.message.localeCompare(b.message)));
  });
});
