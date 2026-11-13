import { ModeButton } from "../ModeButton/ModeButton.tsx";
import { SettingsButton } from "../SettingsButton/SettingsButton.tsx";
import { type FooterSlotProps, hiddenOptionsFor } from "../slots.ts";

/** The default `settings` slot: the settings button and the Mode button. */
export const DefaultSettings = ({ agent, config, setConfig, failure, stopped }: FooterSlotProps) => (
  <>
    <SettingsButton config={config} setConfig={setConfig} failure={failure} stopped={stopped} hidden={hiddenOptionsFor(agent.harness)} />
    <ModeButton config={config} setConfig={setConfig} failure={failure} stopped={stopped} />
  </>
);
