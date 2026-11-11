// A text over the limit shows clipped, says how much was left out and offers Show all; shown all, it's whole and
// nothing is said to be missing. The button carries no aria-expanded (it isn't a collapsed part of the chat).
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MAX_SHOWN_CHARS, shownText } from "../clip-text.ts";
import { Markdown } from "../Markdown/Markdown.tsx";

const long = `${"a".repeat(MAX_SHOWN_CHARS)}TAIL`;

test("clipped until shown all, then whole", () => {
  expect(shownText(long, false)).toEqual({ shown: "a".repeat(MAX_SHOWN_CHARS), omitted: 4 });
  expect(shownText(long, true)).toEqual({ shown: long, omitted: 0 });
});

test("a long text renders clipped, with the count and a Show all button that isn't a collapsed part", () => {
  const html = renderToStaticMarkup(<Markdown text={long} />);
  expect(html).not.toContain("TAIL");
  expect(html).toContain("4 characters left out");
  expect(html).toMatch(/<button[^>]*>Show all<\/button>/);
  expect(html).not.toMatch(/\saria-expanded=/);
  expect(renderToStaticMarkup(<Markdown text="short" />)).not.toContain("Show all");
});
