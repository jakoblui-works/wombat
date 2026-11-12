import { optionByCategory } from "@wombat/shared/api";
import { useState } from "react";

import { Button } from "../../../../../../components/ui/button";
import { isSelect, SelectList } from "../SelectList/SelectList.tsx";
import { SettingsDialog } from "../SettingsDialog/SettingsDialog.tsx";
import { currentName } from "../SettingsButton/SettingsButton.tsx";
import type { FooterSlotProps } from "../slots.ts";

/** The `mode` option's own button, showing its current value and opening that option's list; absent without a mode. */
export const ModeButton = ({ config, setConfig, failure }: Pick<FooterSlotProps, "config" | "setConfig" | "failure">) => {
  const [open, setOpen] = useState(false);
  const mode = optionByCategory(config ?? [], "mode");
  if (mode === undefined || !isSelect(mode)) return null;
  return (
    <>
      <Button variant="ghost" size="xs" aria-label={`Mode: ${currentName(mode) ?? mode.name}`} aria-haspopup="dialog" className="max-w-40 text-fg-secondary" onClick={() => setOpen(true)}>
        <span className="truncate">{currentName(mode) ?? mode.name}</span>
      </Button>
      <SettingsDialog open={open} onOpenChange={setOpen} title={mode.name} failure={failure}>
        <SelectList option={mode} onPick={(value) => void setConfig(mode.id, value)} />
      </SettingsDialog>
    </>
  );
};
