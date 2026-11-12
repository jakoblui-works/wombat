import { type ConfigOption, selectGroups, selectValues } from "@wombat/shared/api";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";

import { cn } from "../../../../../../lib/utils";

export type SelectConfig = Extract<ConfigOption, { type: "select" }>;
export const isSelect = (option: ConfigOption): option is SelectConfig => option.type === "select" && "options" in option;

type Entry = ReturnType<typeof selectValues>[number];

/** The values of one select as a list: name, description, and a check on the current one. A pick sets at once; the checked value is always the option's own, so a refused pick snaps back. One Tab stop; the arrows move and pick. */
export const SelectList = ({ option, onPick }: { option: SelectConfig; onPick: (value: string) => void }) => {
  const groups = selectGroups(option);
  const row = ({ value, name, description }: Entry) => {
    const current = value === option.currentValue;
    return (
      <Radio.Root
        key={value}
        value={value}
        nativeButton={false}
        className={cn("focus-ring flex w-full items-start gap-2 rounded-md px-2 py-1.5 cursor-default text-left hover:bg-surface-3", current && "bg-surface-3")}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg-primary">{name}</span>
          {description === undefined || description === "" ? null : <span className="block text-xs text-fg-tertiary">{description}</span>}
        </span>
        <Check aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 text-fg-primary", !current && "invisible")} />
      </Radio.Root>
    );
  };
  return (
    <RadioGroup aria-label={option.name} value={option.currentValue} onValueChange={(value) => onPick(String(value))} className="flex flex-col">
      {groups === undefined
        ? selectValues(option).map(row)
        : groups.map((group) => (
            <div key={group.group} role="group" aria-label={group.name} className="flex flex-col">
              <span className="px-2 pt-1.5 pb-0.5 text-xs text-fg-tertiary">{group.name}</span>
              {group.options.map(row)}
            </div>
          ))}
    </RadioGroup>
  );
};
