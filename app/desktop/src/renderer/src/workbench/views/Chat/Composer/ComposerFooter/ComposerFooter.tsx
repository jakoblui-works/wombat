import type { ConfigOption } from "@wombat/shared/api";
import { useState } from "react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../../../../components/ui/select";
import { Switch } from "../../../../../components/ui/switch";
import type { Usage } from "../../../../../data/chat-model.ts";
import { asError } from "../../../../../lib/errors.ts";
import { ContextRing } from "./ContextRing/ContextRing.tsx";

type Props = {
  toolName: string;
  options: ConfigOption[] | undefined;
  usage: Usage | undefined;
  /** Sets an option; a rejection is shown under the footer. */
  onSet: (configId: string, value: string | boolean) => Promise<unknown> | void;
};

type Set = (configId: string, value: string | boolean) => void;
type SelectConfig = Extract<ConfigOption, { type: "select" }>;
type Entry = { value: string; name: string };
type Group = { group: string; name: string; options: Entry[] };

const isSelect = (option: ConfigOption): option is SelectConfig => option.type === "select" && "options" in option;
const isBoolean = (option: ConfigOption): option is Extract<ConfigOption, { type: "boolean" }> =>
  option.type === "boolean" && typeof option.currentValue === "boolean";

/** An option type this app doesn't know, as text. */
const readOnlyText = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);

const groupsOf = (option: SelectConfig): Group[] | undefined => {
  const groups = option.options.filter((entry): entry is Group => "group" in entry);
  return groups.length === 0 ? undefined : groups;
};
const entriesOf = (option: SelectConfig): Entry[] =>
  option.options.flatMap((entry): Entry[] => ("group" in entry ? entry.options : [entry]));

const SelectOption = ({ option, onSet }: { option: SelectConfig; onSet: Set }) => {
  const groups = groupsOf(option);
  const entries = entriesOf(option);
  return (
    <Select
      value={option.currentValue}
      onValueChange={(value) => value !== null && onSet(option.id, value)}
      items={entries.map(({ value, name }) => ({ value, label: name }))}
    >
      <SelectTrigger
        aria-label={option.name}
        title={option.description}
        className="h-6 w-auto max-w-44 border-transparent bg-transparent px-1.5 text-sm text-fg-secondary"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups === undefined
          ? entries.map(({ value, name }) => (
              <SelectItem key={value} value={value}>
                {name}
              </SelectItem>
            ))
          : groups.map((group) => (
              <SelectGroup key={group.group}>
                <SelectLabel>{group.name}</SelectLabel>
                {group.options.map(({ value, name }) => (
                  <SelectItem key={value} value={value}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
      </SelectContent>
    </Select>
  );
};

const OptionControl = ({ option, onSet }: { option: ConfigOption; onSet: Set }) => {
  if (isSelect(option)) return <SelectOption option={option} onSet={onSet} />;
  if (isBoolean(option)) {
    return (
      <label className="flex items-center gap-1.5 text-sm text-fg-secondary" title={option.description}>
        <Switch aria-label={option.name} checked={option.currentValue} onCheckedChange={(checked) => onSet(option.id, checked)} />
        <span aria-hidden="true">{option.name}</span>
      </label>
    );
  }
  const value = option.currentValue;
  return (
    <span className="text-sm text-fg-secondary" title={option.description}>
      {option.name}
      {value === undefined || value === null ? "" : `: ${readOnlyText(value)}`}
    </span>
  );
};

/** Under the message box: the agent's tool, its settings as the log has them, and how full its context is. */
export const ComposerFooter = ({ toolName, options, usage, onSet }: Props) => {
  const [failure, setFailure] = useState<string>();
  // Values shown are always the log's (`options`); only the error of the last set is kept here.
  const set: Set = (configId, value) => {
    const run = async () => {
      try {
        await onSet(configId, value);
        setFailure(undefined);
      } catch (error) {
        setFailure(asError(error).message);
      }
    };
    void run();
  };
  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="mx-auto w-full max-w-chat">
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm text-fg-tertiary">{toolName}</span>
          {(options ?? []).map((option) => (
            <OptionControl key={option.id} option={option} onSet={set} />
          ))}
          {usage === undefined ? null : <ContextRing usage={usage} />}
        </div>
        {failure === undefined ? null : (
          <p role="alert" className="pt-1 text-sm text-danger">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
};
