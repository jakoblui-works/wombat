import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "../../lib/utils"

function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({ className, children, ...props }: TooltipPrimitive.Popup.Props) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={6} className="isolate z-[70]">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn("rounded-md border border-line-strong bg-popover px-2 py-1 text-sm text-popover-foreground shadow-lg", className)}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipTrigger }
