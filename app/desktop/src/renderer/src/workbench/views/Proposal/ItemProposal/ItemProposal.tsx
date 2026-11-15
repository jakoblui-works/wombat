import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { type Item, ITEM_FIELDS, type LenientProperty, type Problem } from "@wombat/shared/items";
import type { ItemProposalKind } from "@wombat/shared/proposals";
import { Button } from "../../../../components/ui/button";
import { ScrollArea } from "../../../../components/ui/scroll-area";
import { useStructureItems, useStructures } from "../../../../data/hooks.ts";
import { LazyMonacoDiff } from "../../Diff/MonacoDiff/LazyMonacoDiff.tsx";
import { Note } from "../../approvals/Note/Note.tsx";
import { type FieldRow, fieldRows } from "./field-rows.ts";
import { inputText, problemsByField, typedValue, UNKNOWN_ITEM, valueText, withField, withoutField } from "./field-values.ts";

type Fields = Readonly<Record<string, unknown>>;

/** My fields, editable: `change` saves them as I type, `now` right away (a drop or a restore). */
export type ItemEdit = { value: Fields; change: (fields: Record<string, unknown>, now: boolean) => void };

type Option = { value: string; label: string };

const controlClass = "focus-ring h-7 min-w-0 max-w-96 flex-1 rounded-md border border-line-strong bg-surface-1 px-2 text-sm text-fg-primary";

const Problems = ({ problems }: { problems: readonly Problem[] }) =>
  problems.length === 0 ? null : (
    <ul className="flex flex-col gap-0.5 text-sm text-danger">
      {problems.map((problem, index) => (
        <li key={index} className="whitespace-pre-wrap">
          {problem.message}
        </li>
      ))}
    </ul>
  );

/** A property's new value as a control: a select for options and links, a plain text box otherwise (a date too). */
const PropertyControl = ({ name, value, property, links, onChange }: { name: string; value: unknown; property: LenientProperty | undefined; links: readonly Option[]; onChange: (value: unknown) => void }) => {
  const label = `New ${name}`;
  if (property?.type === "select" || property?.type === "link") {
    const known: Option[] = property.type === "select" ? property.options.map((option) => ({ value: option, label: option })) : [...links];
    const chosen = inputText(value);
    const options = [
      ...(property.required && chosen !== "" ? [] : [{ value: "", label: "(none)" }]),
      ...known,
      ...(chosen === "" || known.some((option) => option.value === chosen) ? [] : [{ value: chosen, label: property.type === "link" ? UNKNOWN_ITEM : chosen }]),
    ];
    return (
      <select aria-label={label} value={chosen} onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)} className={controlClass}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return <input type="text" aria-label={label} value={inputText(value)} onChange={(event) => onChange(typedValue(event.target.value, property))} className={controlClass} />;
};

const Value = ({ text, className = "" }: { text: string; className?: string }) =>
  text === "" ? <span className="text-fg-tertiary">none</span> : <span className={`min-w-0 whitespace-pre-wrap break-words ${className}`}>{text}</span>;

/** Which values a row shows: a create's only the new, a delete's only the item's as it is, an update's both. */
type Sides = "new" | "old" | "both";

const sidesOf = (kind: ItemProposalKind): Sides => (kind === "create" ? "new" : kind === "delete" ? "old" : "both");

type RowProps = {
  row: FieldRow;
  sides: Sides;
  property: LenientProperty | undefined;
  text: (value: unknown) => string;
  links: readonly Option[];
  edit: ItemEdit | undefined;
  problems: readonly Problem[];
  /** For a title or body: whether its diff shows in the row, and how to show it there. */
  opened: boolean;
  open: () => void;
  proposalId: string;
};

const Row = ({ row, sides, property, text, links, edit, problems, opened, open, proposalId }: RowProps) => {
  const editing = edit !== undefined;
  const held = Object.hasOwn(row, "mine");
  const newValue = held ? row.mine : row.proposed;
  const isText = ITEM_FIELDS.has(row.name);
  const showsNew = sides !== "old";
  // A body reads in the diff; its row line would repeat it, cut short. Without a new value there is no diff, so it
  // shows whole, without the line break that follows the title.
  const preview = (value: unknown) => {
    if (row.name !== "body") return text(value);
    return showsNew ? (text(value).trim().split("\n")[0] ?? "") : text(value).replace(/^\r?\n/, "");
  };
  return (
    <div role="group" aria-label={row.name} className="flex flex-col gap-1.5 border-b border-line px-3 py-2">
      <div className="flex min-h-7 items-center gap-2 text-sm">
        <span aria-hidden className="w-24 shrink-0 font-mono text-xs text-fg-tertiary">
          {row.name}
        </span>
        {sides === "new" ? null : (
          <>
            <Value text={preview(row.old)} className={showsNew ? "text-fg-secondary" : "text-fg-primary"} />
            {showsNew ? <ArrowRight aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" /> : null}
          </>
        )}
        {!showsNew ? null : row.dropped ? (
          <>
            <Value text={preview(row.proposed)} className="text-fg-tertiary line-through" />
            <span className="text-xs text-fg-tertiary">dropped from your version</span>
          </>
        ) : editing && !isText ? (
          <PropertyControl name={row.name} value={edit.value[row.name]} property={property} links={links} onChange={(value) => edit.change(withField(edit.value, row.name, value), false)} />
        ) : (
          <Value text={preview(newValue)} className="text-fg-primary" />
        )}
        <span className="ml-auto flex shrink-0 gap-1.5">
          {isText && !opened && !row.dropped && showsNew ? (
            <Button variant="ghost" size="xs" onClick={open}>
              Show the diff
            </Button>
          ) : null}
          {editing && row.dropped ? (
            <Button variant="secondary" size="xs" onClick={() => edit.change(withField(edit.value, row.name, row.proposed), true)}>
              Bring back
            </Button>
          ) : null}
          {editing && !row.dropped ? (
            <Button variant="secondary" size="xs" onClick={() => edit.change(withoutField(edit.value, row.name), true)}>
              Drop
            </Button>
          ) : null}
        </span>
      </div>
      <Problems problems={problems} />
      {isText && opened && !row.dropped && showsNew ? (
        <LazyMonacoDiff
          path={`${proposalId}/${row.name}.md`}
          oldText={text(row.old)}
          newText={text(editing ? edit.value[row.name] : newValue)}
          edit={editing ? { onChange: (value) => edit.change(withField(edit.value, row.name, value), false) } : undefined}
          className={row.name === "body" ? "h-80 shrink-0" : "h-16 shrink-0"}
        />
      ) : null}
    </div>
  );
};

/**
 * An item proposal's fields, one row each, old beside new: a create's are all new, a delete's are the item as it is.
 * With `edit`, each new value is editable (a property in its row, the title and body in the diff, one at a time) and
 * can be dropped from my version and brought back. `problems` show at their field, the rest above the rows.
 */
export const ItemProposal = ({
  proposalId,
  structureId,
  kind,
  current,
  fields,
  mine,
  edit,
  problems,
}: {
  proposalId: string;
  structureId: string;
  kind: ItemProposalKind;
  current: Item | null;
  /** The agent's version's fields. */
  fields: Fields;
  /** My version's fields while they differ from the agent's. */
  mine: Fields | undefined;
  edit: ItemEdit | undefined;
  problems: readonly Problem[];
}) => {
  const structures = useStructures();
  const structure = structures.data?.structures.find((each) => each.id === structureId);
  const properties = structure?.id === null || structure === undefined ? {} : structure.properties;
  const targets = [...new Set(Object.values(properties).flatMap((property) => (property.type === "link" ? [property.to] : [])))];
  const items = useStructureItems(targets);
  const listed = items.flatMap((read) => read.data?.items ?? []);
  const handles = new Map(listed.flatMap((item) => (item.id === null || item.handle === null ? [] : [[item.id, item.handle] as const])));
  const linksTo = (to: string): Option[] =>
    (items[targets.indexOf(to)]?.data?.items ?? []).flatMap((item) => (item.id === null || item.handle === null ? [] : [{ value: item.id, label: `${item.handle} · ${item.title ?? ""}` }]));
  const rows = fieldRows(current, fields, mine, kind);
  const names = rows.map(({ name }) => name);
  const [chosen, setChosen] = useState<string>();
  const opened = chosen !== undefined && names.includes(chosen) ? chosen : names.includes("body") ? "body" : "title";
  const split = problemsByField(problems, names);

  if (structures.isPending || items.some((read) => read.isPending)) return <Note>Loading…</Note>;
  return (
    <ScrollArea className="min-h-0 flex-1">
      {split.rest.length === 0 ? null : (
        <div className="border-b border-line px-3 py-1.5">
          <Problems problems={split.rest} />
        </div>
      )}
      {rows.length === 0 ? (
        <Note>{kind === "delete" ? "The item this proposal deletes is gone." : "This proposal changes no field."}</Note>
      ) : (
        rows.map((row) => {
          const property = Object.hasOwn(properties, row.name) ? properties[row.name] : undefined;
          return (
            <Row
              key={row.name}
              row={row}
              sides={sidesOf(kind)}
              property={property}
              text={(value) => valueText(value, property, (id) => handles.get(id))}
              links={property?.type === "link" ? linksTo(property.to) : []}
              edit={edit}
              problems={split.at.get(row.name) ?? []}
              opened={opened === row.name}
              open={() => setChosen(row.name)}
              proposalId={proposalId}
            />
          );
        })
      )}
    </ScrollArea>
  );
};
