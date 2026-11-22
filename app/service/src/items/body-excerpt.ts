import { cutFolded } from "../excerpt.ts";

/** The most UTF-16 code units an item's excerpt holds, its "…" included. */
export const BODY_EXCERPT_LENGTH = 1000;

const MARKER = /^(?:[-*+]|\d+\.|>|#{1,6})(?:\s+|$)/;

const ELLIPSIS = "…";

export const bodyExcerpt = (body: string | null): string | null => {
  if (body === null) return null;
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() === "");
  const [first = "", ...rest] = lines.slice(start, end === -1 ? undefined : end);
  const text = cutFolded([first.trimStart().replace(MARKER, ""), ...rest].join("\n"), BODY_EXCERPT_LENGTH, ELLIPSIS);
  return text === "" ? null : text;
};
