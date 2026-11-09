// One item file's text: the YAML frontmatter between `---` lines, the title (the first non-blank line after it,
// a `# ` heading) and the body (everything after the title line). Parsing keeps the offsets that edits need, so
// an edit replaces only the bytes it's about and every other byte (comments, key order, CRLF) stays.
import { isDeepStrictEqual } from "node:util";

import { isMap, isScalar, LineCounter, parseDocument, type Pair, type YAMLMap } from "yaml";

import type { Problem } from "@wombat/shared/items";

/** A file whose frontmatter parses (or that has none). */
export type ParsedItemFile = {
  ok: true;
  text: string;
  /** The line ending of the file's first line, used for lines the service adds. */
  eol: string;
  /** The frontmatter's map, null when the file has none or it holds no keys. */
  map: YAMLMap | null;
  /** Offset of the frontmatter's first line (after the opening `---`); null when the file has no frontmatter. */
  frontmatterStart: number | null;
  /** Offset of the closing `---` line, where added keys go; null when the file has no frontmatter. */
  frontmatterEnd: number | null;
  /** Offset of the text after a leading BOM: where a new frontmatter block goes. */
  textStart: number;
  /** The frontmatter as plain values. */
  data: Record<string, unknown>;
  /** Null when the file has no title line; then `body` is null too. */
  title: string | null;
  body: string | null;
  /** The title line's offsets without its line ending, and whether it has one; null when the file has no title line. */
  titleLine: { start: number; end: number; hasEol: boolean } | null;
  /** Title problems (a first-sight write needs none); the frontmatter's are the validator's. */
  problems: Problem[];
};

/** A file whose frontmatter can't be read: no id, handle, title or body is known. */
export type BrokenItemFile = { ok: false; text: string; problems: Problem[] };

export type ItemFile = ParsedItemFile | BrokenItemFile;

const FENCE = /^---\r?$/;

/** The line ending the file uses first; `\n` for a file of one line. */
const eolOf = (text: string) => {
  const end = text.indexOf("\n");
  return end > 0 && text[end - 1] === "\r" ? "\r\n" : "\n";
};

/** Lines with their start offsets; the last line has no line ending when the text doesn't end with one. */
const linesOf = (text: string, from: number) => {
  const lines: { start: number; end: number; next: number; text: string }[] = [];
  let start = from;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ start, end, next: newline === -1 ? text.length : newline + 1, text: text.slice(start, end) });
    start = end + 1;
  }
  return lines;
};

/** The yaml library's message without its position, which counts from the frontmatter's first line. */
const yamlMessage = (message: string) => (message.split("\n")[0] ?? message).replace(/ at line \d+, column \d+:?$/, "");

/** A line that looks like a frontmatter fence (`---`), maybe with spaces around it. */
const FENCE_LIKE = /^\s*---\s*$/;

/** A leading UTF-8 byte order mark: skipped when parsing, kept in front when writing. */
const BOM = "\uFEFF";

const broken = (text: string, line: number, message: string): BrokenItemFile => ({ ok: false, text, problems: [{ line, message }] });

export const parseItemFile = (text: string): ItemFile => {
  const start = text.startsWith(BOM) ? BOM.length : 0;
  const eol = eolOf(text);
  const lines = linesOf(text, start);
  /** Where the frontmatter would go: after the BOM, or after the opening fence. */
  let frontmatterStart: number | null = null;
  let frontmatterEnd: number | null = null;
  let contentStart = start;
  let map: YAMLMap | null = null;
  let data: Record<string, unknown> = {};

  if (lines[0] !== undefined && FENCE.test(lines[0].text) && lines[0].next > lines[0].end) {
    const close = lines.findIndex((line, index) => index > 0 && FENCE.test(line.text));
    if (close === -1) return broken(text, 1, "frontmatter: the --- on line 1 is never closed; end the frontmatter with a line of ---");
    const closing = lines[close];
    if (closing === undefined) throw new Error("unreachable: the closing line was found");
    frontmatterStart = lines[0].next;
    frontmatterEnd = closing.start;
    contentStart = closing.next;
    const source = text.slice(frontmatterStart, closing.start);
    const lineCounter = new LineCounter();
    const doc = parseDocument(source, { lineCounter });
    const [error] = doc.errors;
    if (error !== undefined) {
      // The yaml library counts from the frontmatter's first line, which is the file's line 2.
      const line = (error.linePos?.[0].line ?? 1) + 1;
      return broken(text, line, `frontmatter: ${yamlMessage(error.message)} (line ${line}); fix the YAML so the item loads`);
    }
    if (doc.contents !== null) {
      if (!isMap(doc.contents) || doc.contents.flow === true) return broken(text, 2, "frontmatter: write it as key: value lines, like repo: api");
      map = doc.contents;
      data = doc.toJS() as Record<string, unknown>;
    }
  }

  const titleIndex = lines.findIndex((line) => line.start >= contentStart && line.text.trim() !== "");
  const titleLine = lines[titleIndex];
  // A fence the parser didn't take (spaces after it, a blank line before it) means frontmatter we can't read:
  // reading on would take its keys for text, and a first-sight write would put a second block in front.
  if (titleLine !== undefined && FENCE_LIKE.test(titleLine.text)) {
    return broken(
      text,
      titleIndex + 1,
      `frontmatter: the --- on line ${titleIndex + 1} isn't read as frontmatter; move it to line 1 with nothing after it`,
    );
  }

  const problems: Problem[] = [];
  let title: string | null = null;
  let body: string | null = null;
  let titleOffsets: ParsedItemFile["titleLine"] = null;
  if (titleLine === undefined || !titleLine.text.startsWith("# ")) {
    const where = titleLine === undefined ? {} : { line: titleIndex + 1 };
    problems.push({ field: "title", ...where, message: "title: no title; start the text after the frontmatter with a # heading, like # Login times out" });
  } else {
    title = titleLine.text.slice(2).trim();
    body = text.slice(titleLine.next);
    const end = text[titleLine.end - 1] === "\r" ? titleLine.end - 1 : titleLine.end;
    titleOffsets = { start: titleLine.start, end, hasEol: titleLine.next > titleLine.end };
    if (title === "") problems.push({ field: "title", line: titleIndex + 1, message: "title: the # heading is empty; give the item a title" });
  }

  return { ok: true, text, eol, map, frontmatterStart, frontmatterEnd, textStart: start, data, title, body, titleLine: titleOffsets, problems };
};

/** The frontmatter pair of `key`, if the file has one. */
export const pairOf = (file: ParsedItemFile, key: string): Pair | undefined =>
  file.map?.items.find((pair) => isScalar(pair.key) && pair.key.value === key);

/** Replaces `[start, end)` of the text; edits apply from the end so earlier offsets stay right. */
export type TextEdit = { start: number; end: number; text: string };

export const applyEdits = (text: string, edits: TextEdit[]) =>
  [...edits].sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), text);

/** The file offsets of a scalar value of `key`, quotes included; undefined when it isn't a scalar. */
export const scalarRange = (file: ParsedItemFile, key: string): { start: number; end: number } | undefined => {
  const value = pairOf(file, key)?.value;
  if (!isScalar(value) || value.range == null || file.frontmatterStart === null) return undefined;
  return { start: file.frontmatterStart + value.range[0], end: file.frontmatterStart + value.range[1] };
};

/** The indentation of the frontmatter map's keys, so added lines join the same map. */
const keyIndent = (file: ParsedItemFile) => {
  const key = file.map?.items[0]?.key;
  if (file.frontmatterStart === null || !isScalar(key) || key.range == null) return "";
  const at = file.frontmatterStart + key.range[0];
  const lineStart = file.text.lastIndexOf("\n", at - 1) + 1;
  const indent = file.text.slice(lineStart, at);
  return /^[ \t]*$/.test(indent) ? indent : "";
};

/**
 * The edits that add `id` and `handle` lines: `id` first in the frontmatter, `handle` right after `id`'s line,
 * at the keys' indentation. A file without frontmatter gets a block with only these lines (after a BOM).
 */
export const addKeyEdits = (file: ParsedItemFile, added: { id?: string; handle?: string }): TextEdit[] => {
  const indent = keyIndent(file);
  const lines = [
    ...(added.id === undefined ? [] : [`id: ${added.id}`]),
    ...(added.handle === undefined ? [] : [`handle: ${added.handle}`]),
  ].map((line) => `${indent}${line}${file.eol}`);
  if (lines.length === 0) return [];
  if (file.frontmatterStart === null) {
    return [{ start: file.textStart, end: file.textStart, text: `---${file.eol}${lines.join("")}---${file.eol}` }];
  }
  const idValue = pairOf(file, "id")?.value;
  if (added.id === undefined && isScalar(idValue) && idValue.range != null) {
    const newline = file.text.indexOf("\n", file.frontmatterStart + idValue.range[1]);
    const at = newline === -1 ? file.text.length : newline + 1;
    return [{ start: at, end: at, text: lines.join("") }];
  }
  return [{ start: file.frontmatterStart, end: file.frontmatterStart, text: lines.join("") }];
};

/**
 * The edits that set frontmatter keys to values written as one line of YAML: an existing value is replaced in
 * place (a comment after it stays), a missing key gets a line at the end of the frontmatter, and null removes
 * the key's line. Undefined when the file has no frontmatter or a key has no value node to replace.
 */
export const setKeyEdits = (file: ParsedItemFile, values: [key: string, value: string | null][]): TextEdit[] | undefined => {
  const { frontmatterStart: offset, frontmatterEnd, text } = file;
  if (offset === null || frontmatterEnd === null) return undefined;
  const edits: TextEdit[] = [];
  const added: string[] = [];
  for (const [key, value] of values) {
    const pair = pairOf(file, key);
    if (pair === undefined) {
      if (value !== null) added.push(`${keyIndent(file)}${key}: ${value}${file.eol}`);
      continue;
    }
    const keyRange = isScalar(pair.key) ? pair.key.range : undefined;
    const valueRange = (pair.value as { range?: [number, number, number] } | null)?.range;
    if (keyRange == null || valueRange == null) return undefined;
    if (value === null) {
      const start = text.lastIndexOf("\n", offset + keyRange[0] - 1) + 1;
      const newline = text.indexOf("\n", offset + Math.max(keyRange[1], valueRange[1]) - 1);
      edits.push({ start, end: newline === -1 ? frontmatterEnd : newline + 1, text: "" });
      continue;
    }
    // An empty value (`key:`) has an empty range right after the colon.
    const empty = valueRange[0] === valueRange[1];
    // A block scalar's range takes in its last line break, which the next key's line needs.
    let end = offset + valueRange[1];
    if (text[end - 1] === "\n") end -= text[end - 2] === "\r" ? 2 : 1;
    edits.push({ start: offset + valueRange[0], end, text: empty ? ` ${value}` : value });
  }
  // One insertion, so added keys keep the order they were given in.
  if (added.length > 0) edits.push({ start: frontmatterEnd, end: frontmatterEnd, text: added.join("") });
  return edits;
};

/** The edit that replaces the title line's text, keeping its line ending; undefined when the file has no title line. */
export const titleEdit = (file: ParsedItemFile, title: string): TextEdit | undefined =>
  file.titleLine === null ? undefined : { start: file.titleLine.start, end: file.titleLine.end, text: `# ${title}` };

/** The edit that replaces everything after the title line; undefined when the file has no title line. */
export const bodyEdit = (file: ParsedItemFile, body: string): TextEdit | undefined => {
  const { titleLine, text, eol } = file;
  if (titleLine === null) return undefined;
  const start = text.length - (file.body ?? "").length;
  // A title on the file's last line, without a line ending, needs one before a body.
  return { start, end: text.length, text: (titleLine.hasEol || body === "" ? "" : eol) + body };
};

/** What an edited file must read back as. */
export type Expected = { data: Record<string, unknown>; title: string | null; body: string | null };

/**
 * The text after the edits, or undefined when it doesn't read back as `expected`: an edit that would change
 * anything it isn't about (frontmatter the new lines don't fit into, a title or body that moved) is never written.
 */
export const checkedText = (file: ParsedItemFile, edits: TextEdit[], expected: Expected): string | undefined => {
  const text = applyEdits(file.text, edits);
  return readsBackAs(text, expected) ? text : undefined;
};

/** True when `text` parses with exactly the expected frontmatter, title and body. */
export const readsBackAs = (text: string, expected: Expected) => {
  const after = parseItemFile(text);
  return after.ok && after.title === expected.title && after.body === expected.body && isDeepStrictEqual(after.data, expected.data);
};
