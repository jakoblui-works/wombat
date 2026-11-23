import { createContext, useContext } from "react";

import { sameView, type ShellState, type ShownView, shownView } from "./shell-state.ts";
import type { ShellNow } from "./ShellProvider.tsx";

export type OpenTicket = { seq: number; view: ShownView };

export const ticketLands = (ticket: OpenTicket, latest: number, now: ShownView): "open" | "wait" | "drop" => {
  if (ticket.seq < latest) return "drop";
  if (now.workspace === undefined) return "wait";
  return sameView(ticket.view, now) ? "open" : "drop";
};

type Waiting = { ticket: OpenTicket; open: () => void };

const viewOf = ({ state, agents, workspaces }: ShellNow, leaves: (state: ShellState) => ShellState = (same) => same): ShownView =>
  shownView(leaves(state), agents, workspaces);

/** The page's tickets over what it knows now (`now`); `recheck` must run after each render that changed the state or a list. */
export const openTickets = (now: () => ShellNow) => {
  let latest = 0;
  let waiting: Waiting | undefined;

  const land = (ticket: OpenTicket, open: () => void): void => {
    const step = ticketLands(ticket, latest, viewOf(now()));
    waiting = step === "wait" ? { ticket, open } : waiting?.ticket === ticket ? undefined : waiting;
    if (step === "open") open();
  };

  return {
    /** `leaves` is the click's own change, which `now()` doesn't have until the next render. */
    take: (leaves?: (state: ShellState) => ShellState): OpenTicket => {
      latest += 1;
      waiting = undefined;
      return { seq: latest, view: viewOf(now(), leaves) };
    },
    land,
    recheck: (): void => {
      if (waiting !== undefined) land(waiting.ticket, waiting.open);
    },
  };
};

export type OpenTickets = ReturnType<typeof openTickets>;

export const OpenTicketContext = createContext<OpenTickets | undefined>(undefined);

export const useOpenTicket = (): Pick<OpenTickets, "take" | "land"> => {
  const tickets = useContext(OpenTicketContext);
  if (tickets === undefined) throw new Error("useOpenTicket is used outside the ShellProvider; render the component inside it.");
  return tickets;
};
