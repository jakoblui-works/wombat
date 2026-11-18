// Where a text still arriving can be cut without showing half-typed Markdown syntax, pure. Only the last line is
// looked at, besides whether it is inside a code fence: syntax spanning lines (emphasis, a link) shows as typed until
// it closes, and so does a table's header row until its delimiter row arrives.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The marker of the code fence still open after `lines`, if one is. */
const openFence = (lines: readonly string[]): string | undefined => {
  let open: string | undefined;
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1];
    if (marker === undefined) continue;
    if (open === undefined) open = marker;
    else if (marker[0] === open[0] && marker.length >= open.length && line.trim() === marker) open = undefined;
  }
  return open;
};

const runLength = (line: string, at: number): number => {
  let end = at;
  while (line[end] === line[at]) end++;
  return end - at;
};

/** The end of the backtick run of exactly `length` after `from` that closes a code span, or -1 (also while it may still grow). */
const codeSpanEnd = (line: string, from: number, length: number): number => {
  for (let at = line.indexOf("`", from); at !== -1; at = line.indexOf("`", at)) {
    const run = runLength(line, at);
    if (run === length) return at + run === line.length ? -1 : at + run;
    at += run;
  }
  return -1;
};

/** Where in `line` (outside code fences) the first emphasis, code span or link still open starts, else its length. */
const inlineCut = (line: string): number => {
  const open: { at: number; mark: string }[] = [];
  const cut = (at: number): number => Math.min(at, open[0]?.at ?? at);
  const lastOpen = (mark: string): number => open.findLastIndex((entry) => entry.mark === mark);
  let at = 0;
  while (at < line.length) {
    const char = line[at] ?? "";
    if (char === "\\") {
      if (at + 1 === line.length) return cut(at);
      at += 2;
    } else if (char === "`") {
      const run = runLength(line, at);
      const end = at + run < line.length ? codeSpanEnd(line, at + run, run) : -1;
      if (end === -1) return cut(at);
      at = end;
    } else if (char === "*" || (char === "~" && line[at + 1] === "~")) {
      const run = runLength(line, at);
      const end = at + run;
      if (end === line.length) return cut(at);
      const mark = char.repeat(run);
      const match = lastOpen(mark);
      if (!/\s/.test(line[at - 1] ?? " ") && match !== -1) open.splice(match);
      else if (!/\s/.test(line[end] ?? " ")) open.push({ at, mark });
      at = end;
    } else if ((char === "~" || char === "!") && at + 1 === line.length) {
      return cut(at);
    } else if (char === "[" || (char === "!" && line[at + 1] === "[")) {
      open.push({ at, mark: "[" });
      at += char === "!" ? 2 : 1;
    } else if (char === "]" && lastOpen("[") !== -1) {
      const match = lastOpen("[");
      if (at + 1 === line.length) return cut(at);
      if (line[at + 1] === "(") {
        const close = line.indexOf(")", at + 2);
        if (close === -1) return cut(at);
        at = close;
      }
      open.splice(match);
      at++;
    } else at++;
  }
  return cut(line.length);
};

/**
 * The longest prefix of `text` that shows no syntax half-typed at its end: an unclosed code span, emphasis or link on
 * the last line, a fence's opening or closing line before it ends, or a lone `-`/`=` line that would turn the
 * paragraph above into a heading for a moment.
 */
export const safePrefix = (text: string): string => {
  const lines = text.split("\n");
  const line = lines.pop() ?? "";
  const lineStart = text.length - line.length;
  const fence = openFence(lines);
  if (fence !== undefined) {
    const closing = fence.startsWith("~") ? /^ {0,3}~+ *$/ : /^ {0,3}`+ *$/;
    return line.trim() === "" || closing.test(line) ? text.slice(0, lineStart) : text;
  }
  const above = lines.at(-1) ?? "";
  if (FENCE.test(line) || (/^ {0,3}(-+|=+) *$/.test(line) && above.trim() !== "")) return text.slice(0, lineStart);
  const kept = line.slice(0, inlineCut(line));
  return text.slice(0, kept.trim() === "" ? lineStart : lineStart + kept.length);
};
