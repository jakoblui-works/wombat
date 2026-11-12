// s7-17: an open edit's card shows the changed lines with CONTEXT_LINES of context around them and the answer
// buttons; past MAX_DIFF_LINES it shows no lines and offers only "Open side by side"; several diffs (hunks) each show.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { CONTEXT_LINES, MAX_DIFF_LINES } from "../EditDiff/inline-diff.ts";
import { type EditDiffData, Permission, type PermissionItem } from "./Permission.tsx";

const request: PermissionItem = {
  kind: "permission",
  key: "permission:req-1",
  requestId: "req-1",
  toolCallId: "tool-1",
  title: "Edit notes.txt",
  options: [
    { kind: "allow_once", name: "Allow" },
    { kind: "reject_once", name: "Reject" },
  ],
  at: "2026-01-01T00:00:00.000Z",
};

const render = (edit: EditDiffData): string =>
  renderToStaticMarkup(<Permission item={request} answer={undefined} edit={edit} disabled={false} onAnswer={() => undefined} onOpenSideBySide={() => undefined} />);

const row = (n: number) => `row-${String(n).padStart(3, "0")}`;
const textOf = (rows: string[]) => rows.map((line) => `${line}\n`).join("");

test("the changed line with CONTEXT_LINES of context each side, and the answer buttons", () => {
  const changed = 20;
  const old = Array.from({ length: 40 }, (_, i) => row(i + 1));
  const html = render({ path: "notes.txt", diffs: [{ oldText: textOf(old), newText: textOf(old.map((line, i) => (i + 1 === changed ? "row-changed" : line))) }] });

  expect(html).toContain("row-changed");
  for (let n = changed - CONTEXT_LINES; n <= changed + CONTEXT_LINES; n += 1) expect(html, `line ${String(n)}`).toContain(row(n));
  expect(html).not.toContain(row(changed - CONTEXT_LINES - 1));
  expect(html).not.toContain(row(changed + CONTEXT_LINES + 1));
  for (const name of ["Approve", "Reject", "Open side by side"]) expect(html).toMatch(new RegExp(`${name}</button>`));
});

test("above MAX_DIFF_LINES: no lines and no answer buttons, only Open side by side", () => {
  const added = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => row(i + 1));
  const html = render({ path: "notes.txt", diffs: [{ oldText: "", newText: textOf(added) }] });

  expect(html).not.toContain(row(1));
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toMatch(/Open side by side<\/button>/);
});

test("an edit of several hunks shows each, with the counts summed", () => {
  const html = render({
    path: "notes.txt",
    diffs: [
      { oldText: "first old\n", newText: "first new\n" },
      { oldText: "second old\n", newText: "second new\n" },
    ],
  });
  for (const text of ["first old", "first new", "second old", "second new"]) expect(html).toContain(text);
  expect(html.replace(/<[^>]*>/g, "")).toContain("+2 −2");
});
