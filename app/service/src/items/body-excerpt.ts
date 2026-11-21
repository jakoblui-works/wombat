import { cutAt, foldedText } from "../excerpt.ts";

/** The most UTF-16 code units an item's excerpt holds, its "…" included. */
export const BODY_EXCERPT_LENGTH = 1000;

const MARKER = /^(?:[-*+]|\d+\.|>|#{1,6})(?:\s+|$)/;

const ELLIPSIS = "…";

const cut = (text: string) => {
  const folded = foldedText(text);
  return folded.length <= BODY_EXCERPT_LENGTH ? folded : `${cutAt(folded, BODY_EXCERPT_LENGTH - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
};

export const bodyExcerpt = (body: string | null): string | null => {
  if (body === null) return null;
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() === "");
  const [first = "", ...rest] = lines.slice(start, end === -1 ? undefined : end);
  const text = cut([first.trimStart().replace(MARKER, ""), ...rest].join("\n"));
  return text === "" ? null : text;
};
