import { type ConfigOption, optionByCategory, selectValues } from "@wombat/shared/api";
import { useState } from "react";

import { Button } from "../../../../../../components/ui/button";
import { panelOptions, SettingsDialog, SettingsPanel } from "../SettingsDialog/SettingsDialog.tsx";
import type { FooterSlotProps } from "../slots.ts";

/** The name of a select's current value, or undefined. */
export const currentName = (option: ConfigOption | undefined): string | undefined =>
  option?.type === "select" && "options" in option ? selectValues(option).find(({ value }) => value === option.currentValue)?.name : undefined;

/** "Opus 5.5 · High": the model's and the effort's current names; "Settings" when the agent has neither. */
export const settingsLabel = (config: ConfigOption[] | undefined): string => {
  const names = [currentName(optionByCategory(config ?? [], "model")), currentName(optionByCategory(config ?? [], "thought_level"))];
  const shown = names.filter((name): name is string => name !== undefined);
  return shown.length === 0 ? "Settings" : shown.join(" · ");
};

/** The default `settings` slot's button; hidden when the agent has no option for the dialog to show. */
export const SettingsButton = ({ config, setConfig, failure }: Pick<FooterSlotProps, "config" | "setConfig" | "failure">) => {
  const [open, setOpen] = useState(false);
  if (panelOptions(config).length === 0) return null;
  return (
    <>
      <Button variant="ghost" size="xs" aria-label={`Settings: ${settingsLabel(config)}`} aria-haspopup="dialog" className="max-w-56 text-fg-secondary" onClick={() => setOpen(true)}>
        <span className="truncate">{settingsLabel(config)}</span>
      </Button>
      <SettingsDialog open={open} onOpenChange={setOpen} title="Settings" failure={failure}>
        <SettingsPanel config={config} setConfig={setConfig} />
      </SettingsDialog>
    </>
  );
};
