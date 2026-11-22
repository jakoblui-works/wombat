import { useState } from "react";

type Seen = { state: string | undefined; confirming: boolean };

/**
 * Which failure is no longer shown once the agent's state or the delete dialog changed from `seen` to `now`: the one
 * there now, when the state moved on or the dialog closed (it showed a delete's failure itself); else `dismissed`.
 */
export const dismissedAfter = (seen: Seen, now: Seen, error: Error | undefined, dismissed: Error | undefined): Error | undefined =>
  seen.state !== now.state || (seen.confirming && !now.confirming) ? error : dismissed;

/** The failure to show: none while the dialog is open or once dismissed. */
export const shownError = (error: Error | undefined, dismissed: Error | undefined, confirming: boolean): Error | undefined =>
  confirming || error === dismissed ? undefined : error;

/**
 * The stop or delete failure to show beside an agent (its row, the chat's header): none while the delete dialog is
 * open, and not again once that dialog closes or the agent's state moves on.
 */
export const useActionError = (error: Error | undefined, state: string | undefined, confirming: boolean): Error | undefined => {
  const [dismissed, setDismissed] = useState<Error>();
  const [seen, setSeen] = useState<Seen>({ state, confirming });
  // Adjusted while rendering (React's pattern for state that follows props), so the old error never flashes.
  if (seen.state !== state || seen.confirming !== confirming) {
    setSeen({ state, confirming });
    setDismissed(dismissedAfter(seen, { state, confirming }, error, dismissed));
  }
  return shownError(error, dismissedAfter(seen, { state, confirming }, error, dismissed), confirming);
};
