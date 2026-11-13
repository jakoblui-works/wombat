import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../../lib/utils"

/**
 * A single-thumb slider. Base UI sets positions through `style=""` attributes, which the page's CSP allows; it injects
 * no <style> element or script (the prehydration script is off unless an inset thumb asks for it).
 */
function Slider({ className, label, valueText, ...props }: SliderPrimitive.Root.Props<number> & { label: string; valueText?: (value: number) => string }) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex h-4 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-surface-3">
          <SliderPrimitive.Indicator className="rounded-full bg-focus" />
          <SliderPrimitive.Thumb
            aria-label={label}
            getAriaValueText={valueText === undefined ? undefined : (_formatted, value) => valueText(value)}
            className="block size-3 rounded-full border border-line-strong bg-fg-primary outline-none has-focus-visible:ring-2 has-focus-visible:ring-focus"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
