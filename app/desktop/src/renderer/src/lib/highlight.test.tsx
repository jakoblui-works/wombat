import { isValidElement, type ReactNode } from "react";
import { expect, test } from "vitest";

import { Code } from "./highlight.tsx";

const SAMPLE = 'export const answer: number = 42; // "<b>not markup</b>"';

type Props = { children?: ReactNode; style?: unknown; dangerouslySetInnerHTML?: unknown };

// Every element props object in a rendered tree.
const elementProps = (node: ReactNode): Props[] => {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementProps(child));
  if (!isValidElement<Props>(node)) return [];
  return [node.props, ...elementProps(node.props.children)];
};

test("token colours are style objects on React elements, with no raw HTML or style strings", () => {
  const props = elementProps(Code({ code: SAMPLE, lang: "typescript" }));
  expect(props.filter((p) => p.dangerouslySetInnerHTML !== undefined)).toEqual([]);
  expect(props.filter((p) => typeof p.style === "string")).toEqual([]);
  const colours = new Set(props.map((p) => (p.style as { color?: string } | undefined)?.color).filter(Boolean));
  expect(colours.size).toBeGreaterThanOrEqual(3);
});

/** How many colours a fence of `code` in `lang` is drawn in. */
const coloursOf = (code: string, lang: string): number =>
  new Set(elementProps(Code({ code, lang })).map((p) => (p.style as { color?: string } | undefined)?.color).filter(Boolean)).size;

test("languages beyond TypeScript are highlighted, by name or alias", () => {
  expect(coloursOf('{ "name": "bakery", "port": 8080, "debug": true }', "json")).toBeGreaterThan(1);
  expect(coloursOf('if [ -f "$HOME/.profile" ]; then echo "found"; fi', "bash")).toBeGreaterThan(1);
});
