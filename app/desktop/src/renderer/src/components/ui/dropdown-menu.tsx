import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "../../lib/utils"
import { POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

function DropdownMenu({ onOpenChange, ...props }: MenuPrimitive.Root.Props) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<MenuPrimitive.Root data-slot="dropdown-menu" onOpenChange={tracking.onOpenChange} {...props} />)
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "sideOffset">) {
  const input = useOpenInput()
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          data-input={input}
          className={cn(
            "min-w-32 origin-(--transform-origin) rounded-lg border border-line-strong bg-popover p-1 text-base text-popover-foreground shadow-lg outline-none",
            POPUP_MOTION,
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-base outline-none select-none data-highlighted:bg-surface-3 data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        variant === "destructive" ? "text-danger" : "text-fg-primary",
        className
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger }
