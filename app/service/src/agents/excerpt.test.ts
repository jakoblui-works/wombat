// The excerpt rule behind an agent's lastText: whitespace folded, trimmed, at most EXCERPT_LENGTH code units, never
// a lone surrogate; and a text kept piece by piece gives the same excerpt as the whole.
import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { EXCERPT_LENGTH, excerpt, keepForExcerpt } from "./excerpt.ts";

/** Any UTF-16 code unit, lone surrogates included, with whitespace of every kind common. */
const codeUnit = fc.oneof(
  fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code)),
  fc.constantFrom(" ", "  ", "\n", "\t", "\r\n", " ", " "),
  fc.constantFrom("😀", "𝔸", "a", "Z"),
);
const anyText = fc.string({ unit: codeUnit, maxLength: 600 });

describe("excerpt", () => {
  test("is folded, trimmed, at most EXCERPT_LENGTH code units, well-formed, and a prefix of the folded text", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const result = excerpt(text);
        expect(result.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
        expect(result).toBe(result.trim());
        expect(result).not.toMatch(/\s\s|[^\S ]/);
        expect(result.isWellFormed()).toBe(true);
        expect(text.toWellFormed().replace(/\s+/g, " ").trim().startsWith(result)).toBe(true);
      }),
    );
  });

  test("a text kept piece by piece with keepForExcerpt gives the excerpt of the whole", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: codeUnit, maxLength: 120 }), { maxLength: 12 }), (pieces) => {
        const kept = pieces.reduce(keepForExcerpt, "");
        expect(kept.length).toBeLessThanOrEqual(EXCERPT_LENGTH + 1);
        expect(excerpt(kept)).toBe(excerpt(pieces.join("")));
      }),
    );
  });
});
