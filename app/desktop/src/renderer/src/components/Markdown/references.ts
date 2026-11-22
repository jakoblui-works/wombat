import { HANDLE_NUMBER_PATTERN, HANDLE_PREFIX_PATTERN } from "@wombat/shared/items";
import type { ExtraProps } from "react-markdown";

type ReferenceSpan = { start: number; end: number; handle: string };

type Element = NonNullable<ExtraProps["node"]>;
type ElementContent = Element["children"][number];

const PREFIX = new RegExp(`^${HANDLE_PREFIX_PATTERN}$`);
/** What a reference may not touch on either side. */
const WORD = "[\\p{L}\\p{M}\\p{N}_-]";

/** The regex of a reference to the binders with `prefixes` (any that isn't a handle prefix is dropped); none for none. */
const referencePattern = (prefixes: readonly string[]): RegExp | undefined => {
  const valid = [...new Set(prefixes.filter((prefix) => PREFIX.test(prefix)))];
  return valid.length === 0 ? undefined : new RegExp(`(?<!${WORD})(?:${valid.join("|")})-${HANDLE_NUMBER_PATTERN}(?!${WORD})`, "gu");
};

/** The references in `text`, with `before` and `after` the text on either side of it, which no reference takes in. */
const matchReferences = (text: string, pattern: RegExp | undefined, before = "", after = ""): ReferenceSpan[] => {
  if (pattern === undefined) return [];
  return [...`${before}${text}${after}`.matchAll(pattern)]
    .map((match) => ({ start: match.index - before.length, end: match.index - before.length + match[0].length, handle: match[0] }))
    .filter(({ start, end }) => start >= 0 && end <= text.length);
};

/** Every text inside a hast node, in order, an image's alt text included. */
export const textOf = (node: ElementContent | Element): string => {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "img") return typeof node.properties.alt === "string" ? node.properties.alt : "";
  return node.children.map(textOf).join("");
};

/** The hast property that marks a reference's element; raw HTML never becomes an element, so text can't forge one. */
const REFERENCE_PROPERTY = "dataReference";

/** The handle the element `node` stands for, when it's a reference. */
export const referenceOf = (node: Element | undefined): string | undefined => {
  const handle: unknown = node?.properties[REFERENCE_PROPERTY];
  return typeof handle === "string" ? handle : undefined;
};

const referenceElement = (handle: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { [REFERENCE_PROPERTY]: handle },
  children: [{ type: "text", value: handle }],
});

/** `text` split around its references, each a reference element. */
const splitText = (text: string, pattern: RegExp, before: string, after: string): ElementContent[] => {
  const spans = matchReferences(text, pattern, before, after);
  if (spans.length === 0) return [{ type: "text", value: text }];
  const parts: ElementContent[] = [];
  let at = 0;
  for (const { start, end, handle } of spans) {
    if (start > at) parts.push({ type: "text", value: text.slice(at, start) });
    parts.push(referenceElement(handle));
    at = end;
  }
  if (at < text.length) parts.push({ type: "text", value: text.slice(at) });
  return parts;
};

/** An inline code span whose whole text is one reference, as that reference. */
const codeReference = (code: Element, pattern: RegExp): Element | undefined => {
  const [only, ...rest] = code.children;
  if (only?.type !== "text" || rest.length > 0) return undefined;
  const [span, ...more] = matchReferences(only.value, pattern);
  return span !== undefined && more.length === 0 && span.start === 0 && span.end === only.value.length ? referenceElement(span.handle) : undefined;
};

/**
 * Marks the references in `parent`'s text; never inside a link (a heading's anchor is one) or a code block. `before` and
 * `after` are the characters next to `parent`, so `*x*AP-3` holds no reference.
 */
const markReferences = (parent: { children: ElementContent[] }, pattern: RegExp, before = "", after = ""): void => {
  const { children } = parent;
  const textAt = (index: number) => {
    const node = children[index];
    const text = node === undefined ? "" : textOf(node);
    return text === "" ? undefined : text;
  };
  const lastChar = (index: number) => textAt(index)?.slice(-1) ?? before;
  const firstChar = (index: number) => textAt(index)?.slice(0, 1) ?? after;
  parent.children = children.flatMap((child, index): ElementContent[] => {
    if (child.type === "text") return splitText(child.value, pattern, lastChar(index - 1), firstChar(index + 1));
    if (child.type !== "element" || child.tagName === "a" || child.tagName === "pre") return [child];
    if (child.tagName === "code") return [codeReference(child, pattern) ?? child];
    markReferences(child, pattern, lastChar(index - 1), firstChar(index + 1));
    return [child];
  });
};

/**
 * A rehype plugin: the references to items of the binders with `prefixes`, as elements `referenceOf` reads. A reference
 * is a handle (`<prefix>-<number>`) for one of `prefixes`, not touching a letter, digit, `-` or `_`.
 */
export const rehypeReferences = (prefixes: readonly string[]) => {
  const pattern = referencePattern(prefixes);
  return (tree: { children: ElementContent[] }) => {
    if (pattern !== undefined) markReferences(tree, pattern);
  };
};
