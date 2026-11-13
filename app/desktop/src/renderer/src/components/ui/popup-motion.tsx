import { createContext, type ReactNode, useContext, useState } from "react"

import { type OpenInput, openInput } from "../../lib/motion"

const OpenInputContext = createContext<OpenInput>("pointer")

/**
 * A popup's fade: ~100 ms without scale when the pointer opened it; the keyboard's opens appear (and close) at once.
 * Applied on the popup, which carries `data-input` from the root's last open (`useOpenInput`).
 */
export const POPUP_MOTION =
  "transition-opacity duration-(--duration-exit) data-starting-style:opacity-0 data-ending-style:opacity-0 data-[input=keyboard]:transition-none"

/** The input of the popup's last open, read from the root's open-change event. */
export const useOpenInput = () => useContext(OpenInputContext)

/** Tracks how a root's popup was opened: its `onOpenChange` to hand on, and the provider that gives the popup the input. */
export function useOpenTracking<Details extends { event: Event }>(onOpenChange: ((open: boolean, details: Details) => void) | undefined) {
  const [input, setInput] = useState<OpenInput>("pointer")
  return {
    onOpenChange: (open: boolean, details: Details) => {
      if (open) setInput(openInput(details.event))
      onOpenChange?.(open, details)
    },
    provide: (children: ReactNode) => <OpenInputContext value={input}>{children}</OpenInputContext>,
  }
}
