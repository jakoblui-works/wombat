import type { AgentSummary, ConfigOption, ContextBreakdown } from "@wombat/shared/api";
import type { ComponentType } from "react";

import type { Usage } from "../../../../../data/chat-model.ts";
import { ContextDialog } from "./ContextDialog/ContextDialog.tsx";
import { DefaultContext } from "./DefaultContext/DefaultContext.tsx";
import { DefaultSettings } from "./DefaultSettings/DefaultSettings.tsx";

export type FooterSlotProps = {
  agent: AgentSummary;
  config: ConfigOption[] | undefined;
  usage: Usage | undefined;
  setConfig: (configId: string, value: string | boolean) => Promise<void>;
  /** The last set's refusal, until the next set succeeds; a slot's dialog shows it (the footer's own line is behind the scrim). */
  failure?: string | undefined;
};

/** The context dialog's body; ContextDialogHost owns the dialog's shell, title and close. */
export type ContextDialogProps = { agent: AgentSummary; breakdown: ContextBreakdown | undefined; error: string | undefined };

export type HarnessUi = {
  settings?: ComponentType<FooterSlotProps>;
  context?: ComponentType<FooterSlotProps>;
  contextDialog?: ComponentType<ContextDialogProps>;
};

type Slots = Required<HarnessUi>;

const DEFAULTS: Slots = { settings: DefaultSettings, context: DefaultContext, contextDialog: ContextDialog };

const registry = new Map<string, HarnessUi>();

/** Registers a harness's own components for some slots; a second registration for one harness id throws. */
export const registerHarnessUi = (harnessId: string, ui: HarnessUi): void => {
  if (registry.has(harnessId)) throw new Error(`UI for harness "${harnessId}" is already registered; register each harness once.`);
  registry.set(harnessId, ui);
};

/** The component that fills `slot` for agents of `harnessId`: the harness's override, else the default. */
export const footerSlot = <Slot extends keyof Slots>(harnessId: string, slot: Slot): Slots[Slot] =>
  (registry.get(harnessId)?.[slot] ?? DEFAULTS[slot]) as Slots[Slot];
