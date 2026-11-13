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

/** What a footer button shows while a set waits for the agent to start. */
export const STARTING_LABEL = "Starting…";

/**
 * The default `settings` slot's button; hidden when the agent has no option for the dialog to show. Disabled, its
 * dialog closed, only for an agent that can't be started again (`closed`).
 */
export const SettingsButton = ({ config, setConfig, failure, access, starting, hidden }: Pick<FooterSlotProps, "config" | "setConfig" | "failure" | "access" | "starting"> & { hidden?: readonly string[] | undefined }) => {
  const [open, setOpen] = useState(false);
  if (panelOptions(config, hidden).length === 0) return null;
  const closed = access === "closed";
  const label = starting === true ? STARTING_LABEL : settingsLabel(config);
  return (
    <>
      <Button variant="ghost" size="xs" aria-label={`Settings: ${label}`} aria-haspopup="dialog" disabled={closed} className="max-w-56 text-fg-secondary" onClick={() => setOpen(true)}>
        <span className="truncate">{label}</span>
      </Button>
      <SettingsDialog open={open && !closed} onOpenChange={setOpen} title="Settings" failure={failure}>
        <SettingsPanel config={config} setConfig={setConfig} hidden={hidden} />
      </SettingsDialog>
    </>
  );
};
