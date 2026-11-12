// The default context dialog body: the bar counts only what fills or is held back in the window, the table drops
// `deferred` and ends with `free`, and shares are of the window's size.
import type { ContextBreakdown } from "@wombat/shared/api";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ContextDialog } from "./ContextDialog.tsx";

const breakdown: ContextBreakdown = {
  model: "some-model",
  used: 565_300,
  size: 1_000_000,
  categories: [
    { name: "Free space", tokens: 400_000, kind: "free" },
    { name: "Messages", tokens: 500_000, kind: "used" },
    { name: "Unloaded", tokens: 90_000, kind: "deferred" },
    { name: "Reserve", tokens: 35_000, kind: "buffer" },
  ],
  lists: [{ id: "notes", title: "Notes", rows: [{ name: "a.md", detail: "Project", tokens: 900 }, { name: "b.md", tokens: 12 }] }],
};

const render = (value: ContextBreakdown | undefined, error?: string) =>
  renderToStaticMarkup(<ContextDialog agent={{} as never} breakdown={value} error={error} />);

test("the headline shows the model and the tokens used out of the size, with the share", () => {
  const html = render(breakdown);
  expect(html).toContain("some-model");
  expect(html).toMatch(/565\.3k \/ 1\.0M tokens \(57%\)/);
});

test("the bar stacks the used and buffer categories over the size, leaving out free and deferred", () => {
  const widths = [...render(breakdown).matchAll(/data-slot="context-bar-segment"[^>]*style="width:([\d.]+)%/g)].map((match) => Number(match[1]));
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeCloseTo(50);
  expect(widths[1]).toBeCloseTo(3.5);
});

test("the table leaves deferred out, lists free last, and gives each share of the size", () => {
  const html = render(breakdown);
  const names = ["Messages", "Reserve", "Free space"].map((name) => html.indexOf(`</span>${name}<`));
  expect(names.every((at) => at > 0)).toBe(true);
  expect(names).toEqual([...names].sort((a, b) => a - b));
  expect(html).not.toContain("Unloaded");
  expect(html).toContain(">50%</td>");
  expect(html).toContain(">40%</td>");
});

test("each list shows its title and its rows, the detail only when there is one", () => {
  const html = render(breakdown);
  expect(html).toContain("Notes");
  expect(html).toContain("Project");
  expect(html).toContain("a.md");
  expect(html).toContain("b.md");
});

test("an error is shown instead of the breakdown", () => {
  expect(render(undefined, "Available once the agent is idle")).toContain("Available once the agent is idle");
});
