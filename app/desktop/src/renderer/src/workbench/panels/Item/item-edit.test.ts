// An item tab's edits over generated sequences of edits, refreshes (hand edits, agents' writes) and saves: my unsaved
// values never change on a refresh; a change is dropped only when the file as last read holds it (so a change back to
// the value I read, after the file moved on, is kept); a save's answer clears what it sent unless I changed it again
// meanwhile; a stale answer drops what the file now holds; Keep mine saves on the file's new version, never nothing.
// Each expectation is stated against the items fed in, never a value by name. And text typed into a number field
// that isn't a number is never saved: it holds Save back as that field's problem until it's cleared or a number.
import type { Item } from "@wombat/shared/items";
import fc from "fast-check";
import { expect, test } from "vitest";

import { numberDraft } from "./fields/field-input.ts";
import {
  canSave,
  changedFields,
  conflicts,
  editEvent,
  type FieldEdit,
  type FieldValue,
  initialEdit,
  itemEdit,
  type ItemEditState,
  saveProblems,
  saveRequest,
  valueOf,
} from "./item-edit.ts";

// ---- Invented items ----

/** Each field's values, few enough that my edits, the file's changes and the value I read often coincide. */
const POOLS = {
  title: ["Rotate the staging certificate", "Renew the preview certificate", "Quarantine the flaky checkout test"],
  status: ["todo", "doing", null],
  estimate: [1, 3, null],
} satisfies Record<string, FieldValue[]>;
type Field = keyof typeof POOLS;
const FIELDS = Object.keys(POOLS) as Field[];

/** The file's value of a field as the form edits it: the title, or a property's value, absent as null. */
const fileOf = (item: Item, field: Field): FieldValue => {
  if (field === "title") return item.title;
  const value = item.properties[field];
  return value === undefined ? null : (value as FieldValue);
};

let versions = 0;

/** `item` with `values` set, as a new version of its file. */
const withValues = (item: Item, values: readonly (readonly [string, FieldValue])[]): Item => {
  const next: Item = structuredClone(item);
  for (const [field, value] of values) {
    if (field === "title") next.title = value as string;
    else if (value === null) delete next.properties[field];
    else next.properties[field] = value;
  }
  versions += 1;
  next.version = versions.toString(16).padStart(64, "0");
  return next;
};

const FIRST: Item = {
  id: "0196f3c2-3d00-7000-8000-000000000001",
  handle: "TSK-1",
  aliases: [],
  title: "Rotate the staging certificate",
  body: "The current one expires on the 9th.\n",
  properties: {},
  path: "tasks/TSK-1-rotate-staging-cert.md",
  version: "",
  problems: [],
  excerpt: "The current one expires on the 9th.",
  binder: "tasks",
};

// ---- Generated sequences ----

const fieldValue = fc.constantFrom(...FIELDS).chain((field) => fc.constantFrom<FieldValue>(...POOLS[field]).map((value) => [field, value] as const));
const handEdit = fc.array(fieldValue, { minLength: 1, maxLength: 2 });

type Step =
  | { k: "edit"; field: Field; value: FieldValue }
  | { k: "refresh"; hand: (readonly [Field, FieldValue])[] }
  /** A save answered as written, or stale after the file changed meanwhile; with or without an edit of a sent field while it ran. */
  | { k: "save"; stale: boolean; hand: (readonly [Field, FieldValue])[]; reedit: boolean; pick: number }
  | { k: "keepMine" };

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 5, arbitrary: fieldValue.map(([field, value]): Step => ({ k: "edit", field, value })) },
  { weight: 3, arbitrary: handEdit.map((hand): Step => ({ k: "refresh", hand })) },
  { weight: 3, arbitrary: fc.record({ stale: fc.boolean(), hand: handEdit, reedit: fc.boolean(), pick: fc.nat(5) }).map((r): Step => ({ k: "save", ...r })) },
  { weight: 2, arbitrary: fc.constant<Step>({ k: "keepMine" }) },
);

// ---- The run ----

const run = (start: (readonly [Field, FieldValue])[], steps: Step[]): void => {
  let latest = withValues(FIRST, start);
  let state: ItemEditState = initialEdit(latest);

  /** After every step: no change equals the file as last read, and every other field shows the file. */
  const holds = (at: string) => {
    const changed = changedFields(state);
    for (const field of FIELDS) {
      if (Object.hasOwn(changed, field)) expect(changed[field], `${at}: a change to ${field} the file already holds`).not.toEqual(fileOf(latest, field));
      else expect(valueOf(state, field), `${at}: ${field} shows the file`).toEqual(fileOf(latest, field));
    }
  };

  /** Each unsaved value before a new read of the file: still shown, and still a change unless the file now holds it. */
  const keptThroughRead = (before: Record<string, FieldValue>, at: string) => {
    const changed = changedFields(state);
    for (const [field, value] of Object.entries(before)) {
      expect(valueOf(state, field), `${at}: my unsaved ${field}`).toEqual(value);
      expect(Object.hasOwn(changed, field), `${at}: ${field} is a change unless the file holds it now`).toBe(value !== fileOf(latest, field as Field));
    }
  };

  steps.forEach((it, index) => {
    const at = `step ${String(index + 1)} (${it.k})`;
    switch (it.k) {
      case "edit": {
        state = itemEdit(state, { type: "edit", field: it.field, value: it.value });
        const kept = it.value !== fileOf(latest, it.field);
        expect(Object.hasOwn(changedFields(state), it.field), `${at}: ${it.field} is a change exactly when the file as last read differs`).toBe(kept);
        expect(valueOf(state, it.field), `${at}: ${it.field} shows my edit`).toEqual(it.value);
        break;
      }
      case "refresh": {
        const before = changedFields(state);
        latest = withValues(latest, it.hand);
        state = itemEdit(state, { type: "refreshed", item: latest });
        keptThroughRead(before, at);
        break;
      }
      case "save": {
        const sent = saveRequest(state);
        const names = Object.keys(sent.fields) as Field[];
        if (names.length === 0) break;
        state = itemEdit(state, { type: "saving" });
        const again = new Map<string, FieldValue>();
        const field = names[it.pick % names.length];
        const other = field === undefined ? undefined : POOLS[field].find((value) => value !== sent.fields[field] && value !== fileOf(latest, field));
        if (it.reedit && field !== undefined && other !== undefined) {
          state = itemEdit(state, { type: "edit", field, value: other });
          again.set(field, other);
        }
        if (it.stale || sent.version !== latest.version) {
          const before = changedFields(state);
          if (it.stale) latest = withValues(latest, it.hand);
          state = itemEdit(state, { type: "stale", item: latest });
          keptThroughRead(before, at);
        } else {
          latest = withValues(latest, Object.entries(sent.fields));
          state = itemEdit(state, { type: "saved", item: latest });
          const changed = changedFields(state);
          for (const name of names) {
            const changedAgain = again.get(name);
            if (changedAgain === undefined) expect(Object.hasOwn(changed, name), `${at}: ${name} was saved`).toBe(false);
            else expect(changed[name], `${at}: ${name}, changed again while the save ran, stays a change`).toEqual(changedAgain);
          }
          expect(saveRequest(state).version, `${at}: the next save is on the written version`).toBe(latest.version);
        }
        break;
      }
      case "keepMine": {
        if (conflicts(state).length === 0) break;
        state = itemEdit(state, { type: "keepMine" });
        const request = saveRequest(state);
        expect(request.version, `${at}: Keep mine saves on the file's new version`).toBe(latest.version);
        expect(Object.keys(request.fields).length, `${at}: Keep mine has something to save`).toBeGreaterThan(0);
        break;
      }
    }
    holds(at);
  });
};

test("over edits, refreshes and saves, the tab keeps exactly my unsaved changes against the file as last read", () => {
  fc.assert(
    fc.property(fc.array(fieldValue, { maxLength: 3 }), fc.array(step, { minLength: 1, maxLength: 25 }), (start, steps) => {
      run(start, steps);
    }),
    { numRuns: 300 },
  );
});

/** What the number input hands the tab for typed text: its value, or the text when it isn't one (as `Fields.tsx` wires it). */
const typedNumber = (raw: string): FieldEdit => {
  const { text, value } = numberDraft(raw);
  return value === undefined ? { unreadable: text } : value;
};

test.each(["1,5", "1e3", "12abc", "-"])("%j typed into a number field is never saved; clearing it or typing a number lifts the hold", (typed) => {
  const item = withValues(FIRST, [["estimate", 3]]);
  const typedOver = (state: ItemEditState, text: string): ItemEditState => itemEdit(state, editEvent("estimate", typedNumber(text)));
  const withTitle = itemEdit(initialEdit(item), { type: "edit", field: "title", value: "Renew the preview certificate" });

  const held = typedOver(withTitle, typed);
  expect(saveProblems(held).map(({ field }) => field), "a problem at the field").toContain("estimate");
  expect(canSave(held), "Save waits").toBe(false);
  expect(Object.hasOwn(changedFields(held), "estimate"), "no value made from the text is a change").toBe(false);
  expect(Object.hasOwn(saveRequest(held).fields, "estimate"), "nor sent").toBe(false);

  for (const [fix, sends] of [
    ["", null],
    ["7", 7],
  ] as const) {
    const fixed = typedOver(held, fix);
    expect(saveProblems(fixed), `after ${JSON.stringify(fix)}: no problem`).toEqual([]);
    expect(canSave(fixed), `after ${JSON.stringify(fix)}: Save is offered`).toBe(true);
    expect(saveRequest(fixed).fields["estimate"], `after ${JSON.stringify(fix)}: sent`).toBe(sends);
  }
});
