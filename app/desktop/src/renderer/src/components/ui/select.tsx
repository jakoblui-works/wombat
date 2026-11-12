import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "../../lib/utils"

function Select<Value>(props: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "focus-ring flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-1 px-2.5 text-base text-fg-primary select-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-fg-tertiary">
        <ChevronsUpDown className="size-3.5" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className="truncate" {...props} />
}

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner alignItemWithTrigger={false} sideOffset={4} className="isolate z-[60] outline-none">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "min-w-(--anchor-width) rounded-lg border border-line-strong bg-popover p-1 text-base text-popover-foreground shadow-lg outline-none",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-base outline-none select-none data-highlighted:bg-surface-3",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return <SelectPrimitive.GroupLabel data-slot="select-label" className={cn("px-2 py-1 text-sm text-fg-tertiary", className)} {...props} />
}

export { Select, SelectGroup, SelectLabel, SelectContent, SelectItem, SelectTrigger, SelectValue }
