import type { ItemSummary, LenientProperty, LinkValue, Problem } from "@wombat/shared/items";
import { ArrowUpRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { cn } from "../../../../lib/utils";
import { Field as FieldFrame, FIELD_INPUT, type FieldControl } from "../../Desk/Field/Field.tsx";
import { displayValue, MISSING_ITEM } from "../../Desk/view-model/values.ts";
import type { FieldValue } from "../item-edit.ts";
import { clearable, inputValue, type LinkOption, linkOptions, linkTarget, numberDraft, pickedByUser, shownNumber } from "./field-input.ts";
import type { PropertyRow } from "./property-rows.ts";

/** The clear entry of an optional select or link. */
const CLEAR = "None";

const INPUT = cn(FIELD_INPUT, "text-base");

/** The types whose control is an input the label points at; the others are named through aria-labelledby. */
const INPUT_TYPES: ReadonlySet<string> = new Set(["text", "number", "date"]);

type Edit = (field: string, value: FieldValue) => void;

type ControlProps = { name: string; control: FieldControl; labelId: string; property: LenientProperty; value: FieldValue; onEdit: Edit };

const NumberInput = ({ name, control, value, onEdit, required }: Omit<ControlProps, "labelId" | "property"> & { required: boolean }) => {
  const [draft, setDraft] = useState(() => (value === null ? "" : String(value)));
  return (
    <input
      {...control}
      type="text"
      inputMode="decimal"
      className={INPUT}
      value={shownNumber(draft, value)}
      required={required}
      onChange={(event) => {
        const { text, value: next } = numberDraft(event.target.value);
        setDraft(text);
        if (next !== undefined) onEdit(name, next);
      }}
    />
  );
};

const LinkLabel = ({ option }: { option: LinkOption }) => (
  <span className="flex min-w-0 items-baseline gap-1.5">
    {option.handle === null ? null : <span className="shrink-0 font-mono text-xs text-fg-secondary">{option.handle}</span>}{" "}
    <span className="min-w-0 truncate">{option.title ?? option.id}</span>
  </span>
);

const Choice = ({
  control,
  labelId,
  value,
  onChange,
  optional,
  items,
  shown,
}: {
  control: FieldControl;
  labelId: string;
  value: FieldValue;
  onChange: (value: string | null) => void;
  optional: boolean;
  items: { value: string; label: ReactNode }[];
  shown: (value: FieldValue) => ReactNode;
}) => (
  <Select value={value === null ? null : String(value)} onValueChange={(next: string | null, details) => {
      if (pickedByUser(details.reason)) onChange(next);
    }}>
    <SelectTrigger aria-labelledby={labelId} aria-invalid={control["aria-invalid"]} aria-describedby={control["aria-describedby"]} className="min-w-0 flex-1">
      <SelectValue className="min-w-0 truncate">{(current: string | null) => (current === null ? <span className="text-fg-tertiary">none</span> : shown(current))}</SelectValue>
    </SelectTrigger>
    <SelectContent>
      {optional ? <SelectItem value={null}>{CLEAR}</SelectItem> : null}
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const Control = ({
  name,
  control,
  labelId,
  property,
  value,
  onEdit,
  listed,
  onOpenItem,
  fileLink,
}: ControlProps & { listed: Listed; onOpenItem: OpenItem; fileLink: LinkValue | undefined }) => {
  const optional = clearable(property);
  switch (property.type) {
    case "select":
      return (
        <Choice
          control={control}
          labelId={labelId}
          value={value}
          optional={optional}
          onChange={(next) => onEdit(name, next)}
          items={property.options.map((option) => ({ value: option, label: option }))}
          shown={(current) => String(current)}
        />
      );
    case "link": {
      const options = linkOptions(listed(property.to));
      const target = linkTarget(value, listed(property.to), fileLink);
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <Choice
            control={control}
            labelId={labelId}
            value={value}
            optional={optional}
            onChange={(next) => onEdit(name, next)}
            items={options.map((option) => ({ value: option.id, label: <LinkLabel option={option} /> }))}
            shown={() => (target === undefined ? <span className="text-fg-tertiary">{MISSING_ITEM}</span> : <LinkLabel option={target} />)}
          />
          {target === undefined ? null : (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Open ${target.handle ?? target.title ?? target.id}`} onClick={() => onOpenItem(property.to, target.id)}>
              <ArrowUpRight />
            </Button>
          )}
        </div>
      );
    }
    case "number":
      return <NumberInput name={name} control={control} value={value} onEdit={onEdit} required={!optional} />;
    case "text":
    case "date":
      return (
        <input
          {...control}
          type={property.type}
          className={INPUT}
          value={value === null ? "" : String(value)}
          required={!optional}
          onChange={(event) => onEdit(name, inputValue(event.target.value))}
        />
      );
    default:
      return <span className="whitespace-pre-wrap wrap-break-word text-fg-primary">{displayValue(property, value) || "none"}</span>;
  }
};

type Listed = (binderId: string) => readonly ItemSummary[] | undefined;
type OpenItem = (binderId: string, itemId: string) => void;

const Field = ({
  row,
  property,
  value,
  onEdit,
  saveProblems,
  file,
  listed,
  onOpenItem,
  fileLink,
}: {
  row: PropertyRow;
  property: LenientProperty;
  value: FieldValue;
  onEdit: Edit;
  saveProblems: readonly Problem[];
  file: string;
  listed: Listed;
  onOpenItem: OpenItem;
  fileLink: LinkValue | undefined;
}) => {
  const problems = [...row.problems, ...saveProblems];
  return (
    <FieldFrame label={row.name} labelsInput={INPUT_TYPES.has(property.type)} problems={problems} file={file} layout="row">
      {(control, labelId) => (
        <Control name={row.name} control={control} labelId={labelId} property={property} value={value} onEdit={onEdit} listed={listed} onOpenItem={onOpenItem} fileLink={fileLink} />
      )}
    </FieldFrame>
  );
};

type Props = {
  rows: readonly PropertyRow[];
  properties: Readonly<Record<string, LenientProperty>>;
  valueOf: (field: string) => FieldValue;
  onEdit: Edit;
  /** A refused save's problems, by property. */
  saveProblems: ReadonlyMap<string, Problem[]>;
  file: string;
  listed: Listed;
  onOpenItem: OpenItem;
  /** A link property's value as the item's file was read. */
  fileLink: (field: string) => LinkValue | undefined;
};

/** The item's properties as a description list, one control per property by its type, its problems under it. */
export const Fields = ({ rows, properties, valueOf, onEdit, saveProblems, file, listed, onOpenItem, fileLink }: Props) => (
  <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-6 gap-y-2 text-sm">
    {rows.flatMap((row) => {
      const property = properties[row.name];
      return property === undefined
        ? []
        : [
            <Field
              key={row.name}
              row={row}
              property={property}
              value={valueOf(row.name)}
              onEdit={onEdit}
              saveProblems={saveProblems.get(row.name) ?? []}
              file={file}
              listed={listed}
              onOpenItem={onOpenItem}
              fileLink={fileLink(row.name)}
            />,
          ];
    })}
  </dl>
);
