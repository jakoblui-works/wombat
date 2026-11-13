import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactElement, ReactNode } from "react"

import { cn } from "../../lib/utils"

/**
 * Content that expands and collapses with its toggle (which the caller keeps: a button with `aria-expanded`). It is
 * out of the DOM while closed. `render` is the panel's element when it isn't a div (a list item).
 */
export function Collapse({ open, children, className, render }: { open: boolean; children: ReactNode; className?: string; render?: ReactElement }) {
  return (
    <Collapsible.Root open={open} render={<div role="none" className="contents" />}>
      <Collapsible.Panel
        {...(render === undefined ? {} : { render })}
        className={cn(
          "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-(--duration-enter) ease-out data-ending-style:h-0 data-starting-style:h-0",
          className
        )}
      >
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
