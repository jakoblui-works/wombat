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

  test("cuts before a surrogate pair that would straddle the limit", () => {
    const text = `${"a".repeat(EXCERPT_LENGTH - 1)}😀 and more`;
    expect(excerpt(text)).toBe("a".repeat(EXCERPT_LENGTH - 1));
  });

  test("leaves a short, already folded text unchanged", () => {
    const words = fc
      .array(fc.stringMatching(/^[^\s]{1,12}$/), { minLength: 1, maxLength: 15 })
      .map((list) => list.join(" "));
    fc.assert(
      fc.property(
        words.filter((text) => text.length <= EXCERPT_LENGTH && text.isWellFormed()),
        (text) => {
          expect(excerpt(text)).toBe(text);
        },
      ),
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
