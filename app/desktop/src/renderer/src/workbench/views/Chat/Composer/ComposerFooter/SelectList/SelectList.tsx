import { type ConfigOption, selectGroups, selectValues } from "@wombat/shared/api";
import { Check } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { cn } from "../../../../../../lib/utils";

export type SelectConfig = Extract<ConfigOption, { type: "select" }>;
export const isSelect = (option: ConfigOption): option is SelectConfig => option.type === "select" && "options" in option;

type Entry = ReturnType<typeof selectValues>[number];

/** The values of one select as a listbox: name, description, and a check on the current one. Arrows move a highlight, Enter or a click sets; the selected value is always the option's own, so a refused pick snaps back. One Tab stop. */
export const SelectList = ({ option, onPick }: { option: SelectConfig; onPick: (value: string) => void }) => {
  const groups = selectGroups(option);
  const entries = selectValues(option);
  const idPrefix = useId();
  const [highlighted, setHighlighted] = useState<string>();
  const active = highlighted !== undefined && entries.some(({ value }) => value === highlighted) ? highlighted : option.currentValue;
  const idOf = (value: string) => `${idPrefix}-${String(entries.findIndex((entry) => entry.value === value))}`;

  useEffect(() => {
    document.getElementById(idOf(active))?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (value: string) => {
    setHighlighted(undefined);
    if (value !== option.currentValue) onPick(value);
  };
  const move = (step: number) => {
    const at = entries.findIndex(({ value }) => value === active);
    const next = entries[Math.min(entries.length - 1, Math.max(0, at + step))];
    if (next !== undefined) setHighlighted(next.value);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) move(step);
    else if (event.key === "Home") move(-entries.length);
    else if (event.key === "End") move(entries.length);
    else if (event.key === "Enter") pick(active);
    else return;
    event.preventDefault();
  };

  const row = ({ value, name, description }: Entry) => {
    const current = value === option.currentValue;
    return (
      <div
        key={value}
        id={idOf(value)}
        role="option"
        aria-selected={current}
        onClick={() => pick(value)}
        onPointerEnter={() => setHighlighted(value)}
        className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 cursor-default text-left", (value === active || current) && "bg-surface-3")}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg-primary">{name}</span>
          {description === undefined || description === "" ? null : <span className="block text-xs text-fg-tertiary">{description}</span>}
        </span>
        <Check aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-fg-primary", !current && "invisible")} />
      </div>
    );
  };
  return (
    <div
      role="listbox"
      aria-label={option.name}
      tabIndex={0}
      aria-activedescendant={idOf(active)}
      onKeyDown={onKeyDown}
      className="focus-ring flex flex-col rounded-md"
    >
      {groups === undefined
        ? entries.map(row)
        : groups.map((group) => (
            <div key={group.group} role="group" aria-label={group.name} className="flex flex-col">
              <span aria-hidden="true" className="px-2 pt-1.5 pb-0.5 text-xs text-fg-tertiary">{group.name}</span>
              {group.options.map(row)}
            </div>
          ))}
    </div>
  );
};
