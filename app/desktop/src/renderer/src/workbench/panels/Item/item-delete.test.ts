// The delete question: whatever happens to it (a delete sent, refused as stale or with problems, the question closed),
// it holds the item as it was asked about, version and all, which is what the delete sends; once a delete was refused
// as stale while it was open, it can never be confirmed again; and a refusal that comes back after it closed leaves it
// as it was. The expected state is kept by hand beside it.
import fc from "fast-check";
import { expect, test } from "vitest";

import { asked, closed, confirmable, type DeletableItem, type DeleteQuestion, refused, sending } from "./item-delete.ts";

const ITEM: DeletableItem = {
  id: "0196f3c2-6a00-7000-8000-000000000001",
  handle: "CH-1",
  title: "Sweep the porch",
  path: "chores/CH-1.md",
  version: "b".repeat(64),
  binder: "chores",
};

type Step = "send" | "stale" | "problems" | "close";

test("a delete question keeps the version it was asked with, and after a stale refusal is never confirmable again; a refusal leaves a closed question alone", () => {
  fc.assert(
    fc.property(fc.boolean(), fc.array(fc.constantFrom<Step>("send", "stale", "problems", "close"), { maxLength: 12 }), (unsaved, steps) => {
      let question: DeleteQuestion | undefined = asked(structuredClone(ITEM), unsaved);
      let open = true;
      let stale = false;
      for (const step of steps) {
        const before = question;
        switch (step) {
          case "send":
            question = sending(question);
            break;
          case "stale":
            question = refused(question, "stale");
            if (open) stale = true;
            else expect(question, "a stale refusal after the question closed").toBe(before);
            break;
          case "problems":
            question = refused(question, [{ field: "title", message: "Invented problem." }]);
            if (!open) expect(question, "a refusal after the question closed").toBe(before);
            break;
          case "close":
            question = closed(question);
            open = false;
            break;
        }
        const said = steps.slice(0, steps.indexOf(step) + 1).join(", ");
        expect(question?.item, `the item asked about, after ${said}`).toEqual(ITEM);
        expect(confirmable(question, false), `confirmable after ${said}`).toBe(open && !stale);
        expect(confirmable(question, true), `confirmable while a delete is on its way, after ${said}`).toBe(false);
      }
    }),
    { numRuns: 300 },
  );
});
