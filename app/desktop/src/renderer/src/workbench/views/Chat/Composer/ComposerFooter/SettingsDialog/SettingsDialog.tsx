import { type ConfigOption, optionByCategory, selectValues } from "@wombat/shared/api";
import { useState } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../../../../../components/ui/dialog";
import { Slider } from "../../../../../../components/ui/slider";
import { Switch } from "../../../../../../components/ui/switch";
import { isSelect, type SelectConfig, SelectList } from "../SelectList/SelectList.tsx";
import type { FooterSlotProps } from "../slots.ts";

export type SettingsPanelProps = Pick<FooterSlotProps, "config" | "setConfig">;

/** An option type this app doesn't know, as text. */
const readOnlyText = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);

type Set = SettingsPanelProps["setConfig"];

/**
 * One step per value, labels under it. The thumb follows the finger while dragging; what it rests on is always the
 * agent's value (`currentValue`), so a refused pick snaps back.
 */
const EffortSlider = ({ option, setConfig }: { option: SelectConfig; setConfig: Set }) => {
  const values = selectValues(option);
  const logged = Math.max(0, values.findIndex(({ value }) => value === option.currentValue));
  const [dragging, setDragging] = useState<number>();
  return (
    <div className="flex flex-col gap-1.5 px-2">
      <Slider
        label={option.name}
        valueText={(index) => values[index]?.name ?? String(index)}
        min={0}
        max={Math.max(0, values.length - 1)}
        step={1}
        value={dragging ?? logged}
        onValueChange={(next) => setDragging(next)}
        onValueCommitted={(next) => {
          setDragging(undefined);
          const picked = values[next];
          if (picked !== undefined && picked.value !== option.currentValue) void setConfig(option.id, picked.value);
        }}
      />
      <div className="flex justify-between text-xs text-fg-tertiary">
        {values.map(({ value, name }) => (
          <span key={value}>{name}</span>
        ))}
      </div>
    </div>
  );
};

const OptionRow = ({ option, slider, setConfig }: { option: ConfigOption; slider: boolean; setConfig: Set }) => {
  if (isSelect(option)) {
    return (
      <Section name={option.name} description={option.description}>
        {slider ? (
          <EffortSlider option={option} setConfig={setConfig} />
        ) : (
          <SelectList option={option} onPick={(value) => void setConfig(option.id, value)} />
        )}
      </Section>
    );
  }
  if (option.type === "boolean" && typeof option.currentValue === "boolean") {
    return (
      <label className="flex items-center justify-between gap-3 px-2">
        <span className="min-w-0">
          <span aria-hidden="true" className="block text-sm text-fg-primary">
            {option.name}
          </span>
          {option.description === undefined ? null : <span className="block text-xs text-fg-tertiary">{option.description}</span>}
        </span>
        <Switch aria-label={option.name} checked={option.currentValue} onCheckedChange={(checked) => void setConfig(option.id, checked)} />
      </label>
    );
  }
  const value = option.currentValue;
  return (
    <p className="px-2 text-sm text-fg-secondary">
      {option.name}
      {value === undefined || value === null ? "" : `: ${readOnlyText(value)}`}
    </p>
  );
};

const Section = ({ name, description, children }: { name: string; description?: string | undefined; children: React.ReactNode }) => (
  <section className="flex flex-col gap-1">
    <h3 className="px-2 text-xs font-medium text-fg-secondary">{name}</h3>
    {description === undefined ? null : <p className="px-2 text-xs text-fg-tertiary">{description}</p>}
    {children}
  </section>
);

/** The options the settings dialog shows, in the agent's order: every one but the one the Mode button owns (matched by identity, so a second mode-category option stays). */
export const panelOptions = (config: ConfigOption[] | undefined): ConfigOption[] => {
  const mode = optionByCategory(config ?? [], "mode");
  return (config ?? []).filter((option) => option !== mode);
};

/** The dialog's body: `panelOptions`, each by its type; the effort option (`thought_level`) as a slider. */
export const SettingsPanel = ({ config, setConfig }: SettingsPanelProps) => {
  const effort = optionByCategory(config ?? [], "thought_level");
  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      {panelOptions(config).map((option) => (
        <OptionRow key={option.id} option={option} slider={option === effort} setConfig={setConfig} />
      ))}
    </div>
  );
};

/** The last refused pick, announced; nothing when there is none. */
export const FailureLine = ({ failure }: { failure: string | undefined }) =>
  failure === undefined ? null : (
    <p role="alert" className="text-sm text-danger">
      {failure}
    </p>
  );

type ShellProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string; failure?: string | undefined; children: React.ReactNode };

/** The dialog shell, with its × and the last refused pick (announced, since the footer's own line is behind the scrim). A pick sets at once and leaves it open. */
export const SettingsDialog = ({ open, onOpenChange, title, failure, children }: ShellProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle className="pr-8">{title}</DialogTitle>
      <DialogClose />
      <DialogDescription className="sr-only">Changes apply at once.</DialogDescription>
      {children}
      <FailureLine failure={failure} />
    </DialogContent>
  </Dialog>
);
