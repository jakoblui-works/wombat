import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "../../lib/utils"
import { POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

function Popover({ onOpenChange, ...props }: PopoverPrimitive.Root.Props) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<PopoverPrimitive.Root data-slot="popover" onOpenChange={tracking.onOpenChange} {...props} />)
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "start",
  side = "top",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  const input = useOpenInput()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="isolate z-50 outline-none">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          data-input={input}
          className={cn(
            "w-80 origin-(--transform-origin) rounded-lg border border-line-strong bg-popover p-3 text-base text-popover-foreground shadow-lg outline-none",
            POPUP_MOTION,
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverContent, PopoverTrigger }
