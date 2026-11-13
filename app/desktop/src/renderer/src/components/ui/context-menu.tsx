import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { cn } from "../../lib/utils"
import { POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

function ContextMenu({ onOpenChange, ...props }: ContextMenuPrimitive.Root.Props) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<ContextMenuPrimitive.Root data-slot="context-menu" onOpenChange={tracking.onOpenChange} {...props} />)
}

function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  const input = useOpenInput()
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          data-input={input}
          className={cn(
            "min-w-40 origin-(--transform-origin) rounded-lg border border-line-strong bg-popover p-1 text-base text-popover-foreground shadow-lg outline-none",
            POPUP_MOTION,
            className
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({ className, ...props }: ContextMenuPrimitive.Item.Props) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-base text-fg-primary outline-none select-none data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
  return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn("my-1 h-px bg-line", className)} {...props} />
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger }
