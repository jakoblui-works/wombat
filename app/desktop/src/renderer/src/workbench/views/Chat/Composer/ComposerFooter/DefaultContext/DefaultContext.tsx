import { ContextRing } from "../ContextRing/ContextRing.tsx";
import type { FooterSlotProps } from "../slots.ts";

/** The default `context` slot: the ring, once the agent has reported usage. */
export const DefaultContext = ({ usage, agent }: FooterSlotProps) => (usage === undefined ? null : <ContextRing usage={usage} agent={agent} />);
