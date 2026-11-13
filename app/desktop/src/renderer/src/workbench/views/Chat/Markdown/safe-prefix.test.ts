// Streamed text is cut with safePrefix on every frame, so what shows must only ever grow: for each longer prefix of a
// text, the cut is a prefix of it and keeps everything the previous cut showed. Otherwise the reply would shrink or
// flicker as it arrives. Random text is built from Markdown's syntax characters so every rule gets hit.
import fc from "fast-check";
import { expect, test } from "vitest";

import { safePrefix } from "./safe-prefix.ts";

const PIECES = ["a", "word", " ", "*", "**", "`", "``", "```", "~", "~~", "~~~", "[", "]", "(", ")", "!", "\\", "\n", "-", "=", "_", "|", "    ", "  "];
const markdownish = fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 24 }).map((pieces) => pieces.join(""));

test("as text arrives, the safe prefix is always a prefix of it and never shrinks", () => {
  fc.assert(
    fc.property(markdownish, (text) => {
      let before = "";
      for (let end = 0; end <= text.length; end++) {
        const arrived = text.slice(0, end);
        const shown = safePrefix(arrived);
        expect(arrived.startsWith(shown), `${JSON.stringify(shown)} is a prefix of ${JSON.stringify(arrived)}`).toBe(true);
        expect(shown.startsWith(before), `${JSON.stringify(arrived)} shows ${JSON.stringify(shown)}, less than ${JSON.stringify(before)}`).toBe(true);
        before = shown;
      }
    }),
    { numRuns: 3_000 },
  );
});
