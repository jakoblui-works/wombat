import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import { cn } from "../../lib/utils"
import { HOVER_POPUP_LAYER, POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

const createPreviewCardHandle = PreviewCardPrimitive.createHandle

function PreviewCard<Payload>({ onOpenChange, ...props }: PreviewCardPrimitive.Root.Props<Payload>) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<PreviewCardPrimitive.Root<Payload> data-slot="preview-card" onOpenChange={tracking.onOpenChange} {...props} />)
}

function PreviewCardTrigger<Payload>(props: PreviewCardPrimitive.Trigger.Props<Payload>) {
  return <PreviewCardPrimitive.Trigger data-slot="preview-card-trigger" {...props} />
}

function PreviewCardContent({
  className,
  side = "right",
  align = "start",
  sideOffset = 6,
  anchor,
  ...props
}: PreviewCardPrimitive.Popup.Props & Pick<PreviewCardPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "anchor">) {
  const input = useOpenInput()
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} anchor={anchor} className={cn(HOVER_POPUP_LAYER, "outline-none")}>
        <PreviewCardPrimitive.Popup
          data-slot="preview-card-content"
          data-input={input}
          className={cn("rounded-md border border-line-strong bg-popover text-sm text-popover-foreground shadow-lg outline-none", POPUP_MOTION, className)}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { createPreviewCardHandle, PreviewCard, PreviewCardContent, PreviewCardTrigger }
