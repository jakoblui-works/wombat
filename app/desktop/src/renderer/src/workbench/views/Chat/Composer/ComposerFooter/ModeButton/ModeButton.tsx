import { ACP_CATEGORY, optionByCategory } from "@wombat/shared/api";
import { useState } from "react";

import { Button } from "../../../../../../components/ui/button";
import { isSelect, SelectList } from "../SelectList/SelectList.tsx";
import { SettingsDialog } from "../SettingsDialog/SettingsDialog.tsx";
import { currentName, STARTING_LABEL } from "../SettingsButton/SettingsButton.tsx";
import type { FooterSlotProps } from "../slots.ts";

/**
 * The `mode` option's own button, showing its current value and opening that option's list; absent without a mode.
 * Disabled, its dialog closed, only for an agent that can't be started again (`closed`).
 */
export const ModeButton = ({ config, setConfig, failure, access, starting }: Pick<FooterSlotProps, "config" | "setConfig" | "failure" | "access" | "starting">) => {
  const [open, setOpen] = useState(false);
  const mode = optionByCategory(config ?? [], ACP_CATEGORY.mode);
  if (mode === undefined || !isSelect(mode)) return null;
  const closed = access === "closed";
  const label = starting === true ? STARTING_LABEL : (currentName(mode) ?? mode.name);
  return (
    <>
      <Button variant="ghost" size="xs" aria-label={`Mode: ${label}`} aria-haspopup="dialog" disabled={closed} className="max-w-40 text-fg-secondary" onClick={() => setOpen(true)}>
        <span className="truncate">{label}</span>
      </Button>
      <SettingsDialog open={open && !closed} onOpenChange={setOpen} title={mode.name} failure={failure}>
        <SelectList option={mode} onPick={(value) => void setConfig(mode.id, value)} />
      </SettingsDialog>
    </>
  );
};
