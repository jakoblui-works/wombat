// Monaco gives the right side's text in one line ending; the service writes my draft's bytes as they come. These
// check that what is saved keeps each line's own ending, so a mixed file is never rewritten on lines I didn't touch.
import fc from "fast-check";
import { expect, test } from "vitest";

import { keepLineEndings } from "./line-endings.ts";

test.each<[string, string, string, string, string]>([
  ["a dropped hunk that deleted a line gets the file's ending back", "a\r\nc\r\n", "a\r\nb\r\nc\r\n", "a\r\nb\nc\r\n", "a\r\nb\nc\r\n"],
  ["typing on an LF line below a CRLF line keeps LF", "a\r\nb\nc\r\n", "a\r\nb and more\r\nc\r\n", "a\r\nz\nc\r\n", "a\r\nb and more\nc\r\n"],
  ["deleting a line while editing the next keeps the edited line's own ending", "a\r\nb\nc\r\nd\n", "a\nc2\nd\n", "a\r\nb\nc\r\nd\n", "a\r\nc2\r\nd\n"],
  ["a source's byte order mark is kept", "\uFEFFa\r\nb\nc\r\n", "a\nb2\nc\n", "\uFEFFa\r\nb\nc\r\n", "\uFEFFa\r\nb2\nc\r\n"],
  ["a source without a byte order mark never gains one", "a\r\nb\nc\r\n", "a\nb2\nc\n", "\uFEFFa\r\nb\nc\r\n", "a\r\nb2\nc\r\n"],
])("%s", (_name, source, edited, file, want) => {
  expect(keepLineEndings(source, edited, file)).toBe(want);
});

test("a text the editor gives back unchanged, in either line ending, is the source exactly", () => {
  const line = fc.string({ unit: fc.constantFrom("a", "b", " ", "é", "\t"), maxLength: 4 });
  const ending = fc.constantFrom("\n", "\r\n");
  const text = fc.tuple(fc.array(fc.tuple(line, ending), { maxLength: 8 }), line).map(([lines, last]) => lines.map(([l, end]) => l + end).join("") + last);
  fc.assert(
    fc.property(text, fc.constantFrom("\n", "\r\n"), text, (source, editorEnding, file) => {
      const edited = source.replace(/\r\n|\n/g, editorEnding);
      expect(keepLineEndings(source, edited, file)).toBe(source);
    }),
  );
});

// A long file with mixed endings; "line N" each occurs once, so every untouched line is known by its text.
const ENDINGS = ["\r\n", "\n", "\n"] as const;
const longSource = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${String(index)}${ENDINGS[index % ENDINGS.length] ?? "\n"}`).join("");
const endingsByLine = (text: string): Map<string, string> =>
  new Map([...text.matchAll(/([^\r\n]*)(\r\n|\n)/g)].map(([, line, end]) => [line ?? "", end ?? ""]));

test.each<[string, (lines: string[]) => string[]]>([
  ["one line inserted near the top and one edited near the bottom", (lines) => [...lines.slice(0, 5), "a new line", ...lines.slice(5, 2_900), "line 2900, edited", ...lines.slice(2_901)]],
  [
    "a line inserted near the top and a block rewritten past what is diffed line by line",
    (lines) => [...lines.slice(0, 5), "a new line", ...lines.slice(5, 1_000), ...lines.slice(1_000, 2_100).map((_, index) => `rewritten ${String(index)}`), ...lines.slice(2_100)],
  ],
])("a large mixed-ending edit, %s, keeps every untouched line's ending", (_name, edit) => {
  const source = longSource(3_000);
  const edited = `${edit(source.split(/\r\n|\n/).slice(0, -1)).join("\n")}\n`;
  const kept = endingsByLine(keepLineEndings(source, edited, source));
  const want = endingsByLine(source);
  const untouched = [...kept.keys()].filter((line) => want.has(line));
  expect(untouched.length).toBeGreaterThan(1_800);
  expect(untouched.filter((line) => kept.get(line) !== want.get(line))).toEqual([]);
});
