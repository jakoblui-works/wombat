// Monaco gives the right side's text in one line ending; the service writes my draft's bytes as they come. These
// check that what is saved keeps each line's own ending, so a mixed file is never rewritten on lines I didn't touch.
import fc from "fast-check";
import { expect, test } from "vitest";

import { keepLineEndings } from "./line-endings.ts";

test.each<[string, string, string, string, string]>([
  ["a dropped hunk that deleted a line gets the file's ending back", "a\r\nc\r\n", "a\r\nb\r\nc\r\n", "a\r\nb\nc\r\n", "a\r\nb\nc\r\n"],
  ["typing on an LF line below a CRLF line keeps LF", "a\r\nb\nc\r\n", "a\r\nb and more\r\nc\r\n", "a\r\nz\nc\r\n", "a\r\nb and more\nc\r\n"],
  ["deleting a line while editing the next keeps the edited line's own ending", "a\r\nb\nc\r\nd\n", "a\nc2\nd\n", "a\r\nb\nc\r\nd\n", "a\r\nc2\r\nd\n"],
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
