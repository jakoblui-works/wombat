import type { Usage } from "../../../../../../data/chat-model.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../../components/ui/tooltip";

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The share of the context in use, 0 to 1; a size of 0 (or less) is empty. */
export const contextShare = ({ used, size }: Pick<Usage, "used" | "size">): number =>
  size > 0 && Number.isFinite(used / size) ? Math.min(1, Math.max(0, used / size)) : 0;

/** `<used> / <size> tokens`, then the cost when there is one (ACP sends it absent or null). */
export const usageLabel = ({ used, size, cost }: Usage): string => {
  const tokens = `${used.toLocaleString("en-US")} / ${size.toLocaleString("en-US")} tokens`;
  if (cost === undefined || cost === null) return tokens;
  try {
    return `${tokens}, ${new Intl.NumberFormat("en-US", { style: "currency", currency: cost.currency }).format(cost.amount)}`;
  } catch {
    // A currency code Intl doesn't know.
    return `${tokens}, ${cost.amount} ${cost.currency}`;
  }
};

/** How full the agent's context is, as a ring; the tokens and cost show on hover or focus. */
export const ContextRing = ({ usage }: { usage: Usage }) => {
  const label = usageLabel(usage);
  const filled = contextShare(usage) * CIRCUMFERENCE;
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={label} tabIndex={0} className="focus-ring ml-auto inline-flex rounded-full" />}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="3" className="stroke-fg-tertiary/35" />
          <circle
            data-slot="context-ring-used"
            cx="9"
            cy="9"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
            transform="rotate(-90 9 9)"
            className="stroke-fg-secondary"
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
