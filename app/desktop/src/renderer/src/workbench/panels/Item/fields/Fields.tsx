import type { LenientProperty, LinkValue, Problem } from "@wombat/shared/items";
import { ArrowUpRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { cn } from "../../../../lib/utils";
import { useHoverPreview } from "../../../items/ItemPreview/HoverPreview.tsx";
import { Field as FieldFrame, FIELD_INPUT, type FieldControl } from "../../../items/Field/Field.tsx";
import type { Listed } from "../../../items/use-link-lists.ts";
import { clearable, displayValue, MISSING_ITEM, typesNumber } from "../../../items/values.ts";
import type { FieldEdit } from "../item-edit.ts";
import { type FieldValue, inputValue, type LinkOption, linkOptions, linkTarget, numberDraft, pickedByUser, shownNumber } from "../../../items/field-input.ts";
import type { PropertyRow } from "./property-rows.ts";

/** The clear entry of an optional select or link. */
const CLEAR = "None";

const INPUT = cn(FIELD_INPUT, "text-base");

/** The types whose control is an input the label points at; the others are named through aria-labelledby. */
const INPUT_TYPES: ReadonlySet<string> = new Set(["text", "number", "date"]);

type Edit = (field: string, value: FieldEdit) => void;

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
      onBeforeInput={(event) => {
        if (!typesNumber(event.data)) event.preventDefault();
      }}
      onChange={(event) => {
        const { text, value: next } = numberDraft(event.target.value);
        setDraft(text);
        onEdit(name, next === undefined ? { unreadable: text } : next);
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
  onOpenChange,
}: {
  control: FieldControl;
  labelId: string;
  value: FieldValue;
  onChange: (value: string | null) => void;
  optional: boolean;
  items: { value: string; label: ReactNode }[];
  shown: (value: FieldValue) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) => (
  <Select value={value === null ? null : String(value)} onOpenChange={onOpenChange} onValueChange={(next: string | null, details) => {
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

/** A link's choice, its value with the target's preview on hover, and its Open button, which follows the link. */
const LinkControl = ({
  name,
  control,
  labelId,
  value,
  optional,
  onEdit,
  options,
  target,
  onFollowItem,
}: Omit<ControlProps, "property"> & { optional: boolean; options: LinkOption[]; target: LinkOption | undefined; onFollowItem: FollowItem }) => {
  const [choosing, setChoosing] = useState(false);
  const follow = () => {
    if (target !== undefined) onFollowItem(target.id);
  };
  // Without a target the box isn't rendered, so its empty ref is never read.
  const preview = useHoverPreview({ itemRef: target?.id ?? "", onOpen: follow, disabled: choosing });
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Choice
        control={control}
        labelId={labelId}
        value={value}
        optional={optional}
        onChange={(next) => onEdit(name, next)}
        onOpenChange={setChoosing}
        items={options.map((option) => ({ value: option.id, label: <LinkLabel option={option} /> }))}
        shown={() =>
          target === undefined ? (
            <span className="text-fg-tertiary">{MISSING_ITEM}</span>
          ) : (
            preview.trigger(
              <span className="min-w-0">
                <LinkLabel option={target} />
              </span>,
            )
          )
        }
      />
      {target === undefined ? null : (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Open ${target.handle ?? target.title ?? target.id}`} onClick={follow}>
          <ArrowUpRight />
        </Button>
      )}
      {target === undefined ? null : preview.box}
    </div>
  );
};

const Control = ({
  name,
  control,
  labelId,
  property,
  value,
  onEdit,
  listed,
  onFollowItem,
  fileLink,
}: ControlProps & { listed: Listed; onFollowItem: FollowItem; fileLink: LinkValue | undefined }) => {
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
    case "link":
      return (
        <LinkControl
          name={name}
          control={control}
          labelId={labelId}
          value={value}
          optional={optional}
          onEdit={onEdit}
          options={linkOptions(listed(property.to))}
          target={linkTarget(value, listed(property.to), fileLink)}
          onFollowItem={onFollowItem}
        />
      );
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

type FollowItem = (ref: string) => void;

const Field = ({
  row,
  property,
  value,
  onEdit,
  saveProblems,
  file,
  listed,
  onFollowItem,
  fileLink,
}: {
  row: PropertyRow;
  property: LenientProperty;
  value: FieldValue;
  onEdit: Edit;
  saveProblems: readonly Problem[];
  file: string;
  listed: Listed;
  onFollowItem: FollowItem;
  fileLink: LinkValue | undefined;
}) => {
  const problems = [...row.problems, ...saveProblems];
  return (
    <FieldFrame label={row.name} labelsInput={INPUT_TYPES.has(property.type)} problems={problems} file={file} layout="row">
      {(control, labelId) => (
        <Control name={row.name} control={control} labelId={labelId} property={property} value={value} onEdit={onEdit} listed={listed} onFollowItem={onFollowItem} fileLink={fileLink} />
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
  onFollowItem: FollowItem;
  /** A link property's value as the item's file was read. */
  fileLink: (field: string) => LinkValue | undefined;
};

/** The item's properties as a description list, one control per property by its type, its problems under it. */
export const Fields = ({ rows, properties, valueOf, onEdit, saveProblems, file, listed, onFollowItem, fileLink }: Props) => (
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
              onFollowItem={onFollowItem}
              fileLink={fileLink(row.name)}
            />,
          ];
    })}
  </dl>
);
