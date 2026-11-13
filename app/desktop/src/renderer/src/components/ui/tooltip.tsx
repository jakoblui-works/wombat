import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "../../lib/utils"
import { POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

function Tooltip({ onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<TooltipPrimitive.Root data-slot="tooltip" onOpenChange={tracking.onOpenChange} {...props} />)
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({ className, children, ...props }: TooltipPrimitive.Popup.Props) {
  const input = useOpenInput()
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={6} className="isolate z-[70]">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          data-input={input}
          className={cn("rounded-md border border-line-strong bg-popover px-2 py-1 text-sm text-popover-foreground shadow-lg", POPUP_MOTION, className)}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipTrigger }
