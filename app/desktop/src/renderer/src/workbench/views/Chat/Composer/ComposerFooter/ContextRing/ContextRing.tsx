import type { AgentSummary } from "@wombat/shared/api";

import type { Usage } from "../../../../../../data/chat-model.ts";
import { useNow } from "../../../../../../lib/ago.ts";
import { cn } from "../../../../../../lib/utils";
import { cacheLeft, type CacheState } from "../../../../../../lib/cache.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../../components/ui/tooltip";

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The share of the context in use, 0 to 1; a size of 0 (or less) is empty. */
export const contextShare = ({ used, size }: Pick<Usage, "used" | "size">): number =>
  size > 0 && Number.isFinite(used / size) ? Math.min(1, Math.max(0, used / size)) : 0;

/** The share as text: whole percent, "<1%" for a used but under-1% share, capped at "100%". */
export const sharePercent = (usage: Pick<Usage, "used" | "size">): string => {
  const percent = contextShare(usage) * 100;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
};

/** `<used> / <size> tokens`; the price isn't shown. */
export const usageLabel = ({ used, size }: Usage): string => `${used.toLocaleString("en-US")} / ${size.toLocaleString("en-US")} tokens`;

/** The share the ring turns to its warning colour from, and to its danger colour from. */
export const RING_WARN_SHARE = 0.8;
export const RING_FULL_SHARE = 0.95;

/** What the ring shows for a share. */
export const ringLevel = (share: number): "normal" | "warn" | "full" =>
  share >= RING_FULL_SHARE ? "full" : share >= RING_WARN_SHARE ? "warn" : "normal";

// The warn colour is the amber the agent states use for "waiting".
const ARC_COLOUR = { normal: "stroke-brand", warn: "stroke-state-waiting", full: "stroke-danger" } as const;

/** "5 min" or "1h": how long the cache lives. */
const ttlLabel = (ttlSeconds: number): string => (ttlSeconds >= 3600 && ttlSeconds % 3600 === 0 ? `${ttlSeconds / 3600}h` : `${Math.round(ttlSeconds / 60)} min`);

/** "Cache 1h · 42 min left", or "Cache expired". */
export const cacheLine = (cache: CacheState, now: number): string => {
  const { expired, seconds } = cacheLeft(cache, now);
  if (expired) return "Cache expired";
  const minutes = Math.ceil(seconds / 60);
  return `Cache ${ttlLabel(cache.ttlSeconds)} · ${minutes <= 1 ? "<1" : String(minutes)} min left`;
};

const CACHE_TICK_MS = 30_000;

/** How full the agent's context is, as a ring and a percentage; the tokens and the cache timer show on hover or focus. */
export const ContextRing = ({ usage, agent }: { usage: Usage; agent?: Pick<AgentSummary, "cache"> }) => {
  const cache = agent?.cache ?? undefined;
  const now = useNow({ intervalMs: CACHE_TICK_MS, enabled: cache !== undefined });
  const tokens = usageLabel(usage);
  const cacheText = cache === undefined ? undefined : cacheLine(cache, now);
  const expired = cache !== undefined && cacheLeft(cache, now).expired;
  const share = contextShare(usage);
  const filled = share * CIRCUMFERENCE;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <span
            role="img"
            aria-label={cacheText === undefined ? tokens : `${tokens}. ${cacheText}`}
            data-cache-expired={expired ? "" : undefined}
            tabIndex={0}
            className="focus-ring -my-1 ml-auto inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-xs text-fg-secondary tabular-nums"
          />
        }
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={cn(expired && "opacity-50")}>
          <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="3" className="stroke-fg-tertiary/60" />
          <circle
            data-slot="context-ring-used"
            data-level={ringLevel(share)}
            cx="9"
            cy="9"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="butt"
            strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
            transform="rotate(-90 9 9)"
            className={ARC_COLOUR[ringLevel(share)]}
          />
        </svg>
        <span aria-hidden="true">{sharePercent(usage)}</span>
      </TooltipTrigger>
      <TooltipContent>
        <div>{tokens}</div>
        {cacheText === undefined ? null : <div className="text-fg-secondary">{cacheText}</div>}
      </TooltipContent>
    </Tooltip>
  );
};
