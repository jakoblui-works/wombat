import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "../../lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "focus-ring inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-line-strong bg-surface-3 p-0.5 transition-colors data-checked:bg-focus disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-2.5 rounded-full bg-fg-primary transition-transform data-checked:translate-x-3" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
