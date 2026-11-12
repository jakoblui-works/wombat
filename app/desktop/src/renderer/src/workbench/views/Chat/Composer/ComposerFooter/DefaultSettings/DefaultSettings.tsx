import { ModeButton } from "../ModeButton/ModeButton.tsx";
import { SettingsButton } from "../SettingsButton/SettingsButton.tsx";
import type { FooterSlotProps } from "../slots.ts";

/** The default `settings` slot: the settings button and the Mode button. */
export const DefaultSettings = ({ config, setConfig, failure }: FooterSlotProps) => (
  <>
    <SettingsButton config={config} setConfig={setConfig} failure={failure} />
    <ModeButton config={config} setConfig={setConfig} failure={failure} />
  </>
);
