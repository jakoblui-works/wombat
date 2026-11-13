import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"
import { cn } from "../../lib/utils"
import { POPUP_MOTION, useOpenInput, useOpenTracking } from "./popup-motion"

function Menubar({ className, ...props }: MenubarPrimitive.Props) {
  return <MenubarPrimitive data-slot="menubar" className={cn("flex items-center", className)} {...props} />
}

function MenubarMenu({ onOpenChange, ...props }: MenuPrimitive.Root.Props) {
  const tracking = useOpenTracking(onOpenChange)
  return tracking.provide(<MenuPrimitive.Root data-slot="menubar-menu" onOpenChange={tracking.onOpenChange} {...props} />)
}

function MenubarTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "focus-ring flex h-7 cursor-default items-center rounded-md px-2 text-sm text-fg-secondary outline-none select-none hover:bg-surface-2 hover:text-fg-primary data-popup-open:bg-surface-3 data-popup-open:text-fg-primary",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "align" | "sideOffset">) {
  const input = useOpenInput()
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="menubar-content"
          data-input={input}
          className={cn(
            "min-w-52 origin-(--transform-origin) rounded-lg border border-line-strong bg-popover p-1 text-base text-popover-foreground shadow-lg outline-none",
            POPUP_MOTION,
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenubarItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menubar-item"
      className={cn(
        "flex cursor-default items-center gap-6 rounded-md px-2 py-1.5 text-base text-fg-primary outline-none select-none data-highlighted:bg-surface-3 data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="menubar-separator" className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />
}

/** A command's keys, at the item's right edge. */
function MenubarShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="menubar-shortcut" className={cn("ml-auto text-sm text-fg-tertiary", className)} {...props} />
}

export { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger }
