// s7-12: an answered or cancelled permission shows its outcome and offers no answer buttons; an open one offers them.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { Permission, type PermissionItem } from "./Permission.tsx";

const request = (answer?: PermissionItem["answer"]): PermissionItem => ({
  kind: "permission",
  key: "permission:req-1",
  requestId: "req-1",
  toolCallId: "tool-1",
  title: "Run pnpm test",
  options: [
    { kind: "allow_once", name: "Allow" },
    { kind: "reject_once", name: "Reject" },
    { kind: "allow_always", name: "Always allow" },
  ],
  ...(answer === undefined ? {} : { answer }),
  at: "2026-01-01T00:00:00.000Z",
});

const render = (item: PermissionItem): string =>
  renderToStaticMarkup(<Permission item={item} answer={item.answer} edit={false} disabled={false} onAnswer={() => undefined} />);

test("open: its title and a button per option, Approve and Reject among them", () => {
  const html = render(request());
  expect(html).toContain("Run pnpm test");
  expect(html.match(/<button/g)).toHaveLength(3);
  for (const name of ["Approve", "Reject", "Always allow"]) expect(html).toContain(`>${name}</button>`);
});

test("answered or cancelled: the outcome, and no buttons", () => {
  for (const [answer, said] of [
    ["allow_once", /approved/i],
    ["reject_once", /rejected/i],
    ["cancelled", /cancelled/i],
  ] as const) {
    const html = render(request(answer));
    expect(html, answer).toMatch(said);
    expect(html, answer).toContain("Run pnpm test");
    expect(html, answer).not.toContain("<button");
  }
});
