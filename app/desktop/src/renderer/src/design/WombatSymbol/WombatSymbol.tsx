// The logo's symbol, served from 'self' as a file (?no-inline: a data: URL would be refused by the page's CSP).
import symbolUrl from "../../../../../assets/brand/wombat-symbol.svg?no-inline";

import { cn } from "@/lib/utils";

/** Wombat's symbol in its Dusk gradient; decorative wherever a name sits beside it. */
export const WombatSymbol = ({ className }: { className?: string }) => (
  <img src={symbolUrl} alt="" draggable={false} className={cn("shrink-0 select-none", className)} />
);
