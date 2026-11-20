import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { EXCERPT_LENGTH } from "../excerpt.ts";
import { bodyExcerpt } from "./body-excerpt.ts";

const bodyPiece = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom("\n", "\n\n", "\r\n", "\r", " ", "\t", "- ", "* ", "+ ", "1. ", "> ", "## ", "-", "`x`"),
  fc.string({ minLength: 150, maxLength: 400 }),
);
const anyBody = fc.array(bodyPiece, { maxLength: 20 }).map((pieces) => pieces.join(""));

describe("bodyExcerpt", () => {
  test("is null or one line within the cut", () => {
    fc.assert(
      fc.property(anyBody, (body) => {
        const result = bodyExcerpt(body);
        if (result === null) return;
        expect(result).not.toMatch(/[\n\r]/);
        expect(result.length).toBeGreaterThan(0);
        expect(result.length).toBeLessThanOrEqual(EXCERPT_LENGTH);
      }),
    );
  });

  test.each([
    ["only the first paragraph", "First paragraph\ncontinues here.\n\nSecond paragraph.", "First paragraph continues here."],
    ["a leading dash marker", "- draft the plan", "draft the plan"],
    ["a leading star marker", "* draft the plan", "draft the plan"],
    ["a leading plus marker", "+ draft the plan", "draft the plan"],
    ["a leading number marker", "1. Ship it", "Ship it"],
    ["a leading quote marker", "> a quote", "a quote"],
    ["a leading heading marker", "## Heading", "Heading"],
    ["a marker removed once", "- - nested", "- nested"],
    ["markers on later lines kept", "- first\n- second", "first - second"],
    ["leading blank lines skipped", "\n  \n\nAfter blanks", "After blanks"],
    ["an empty body", "", null],
    ["a whitespace-only body", " \n\t\n ", null],
    ["a marker with text after", "- ", null],
    ["a bare marker", "-", null],
    ["Markdown inside kept", "Run `pnpm test` **now**", "Run `pnpm test` **now**"],
    ["no body", null, null],
  ])("%s", (_case, body, expected) => {
    expect(bodyExcerpt(body)).toBe(expected);
  });
});
