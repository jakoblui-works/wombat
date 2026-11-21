import { excerpt } from "../excerpt.ts";

const MARKER = /^(?:[-*+]|\d+\.|>|#{1,6})(?:\s+|$)/;

export const bodyExcerpt = (body: string | null): string | null => {
  if (body === null) return null;
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim() === "");
  const [first = "", ...rest] = lines.slice(start, end === -1 ? undefined : end);
  const text = excerpt([first.trimStart().replace(MARKER, ""), ...rest].join("\n"));
  return text === "" ? null : text;
};
