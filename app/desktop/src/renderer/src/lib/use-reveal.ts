import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { prefersReducedMotion } from "./motion.ts";
import { followText, type Revealed, revealStart, revealStep } from "./reveal.ts";

/**
 * The part of `text` revealed so far, growing on animation frames at an even pace (`revealStep`) while `streaming`.
 * Not streaming, or under reduced motion, it is all of `text`; a text streaming on first render starts where
 * `revealStart` says (`fromStart`: the message arrived while it was shown).
 */
export const useReveal = (text: string, streaming: boolean, fromStart: boolean): string => {
  const paced = streaming && !prefersReducedMotion();
  const [stored, setStored] = useState<Revealed>(() => ({ text, shown: paced ? revealStart(text, fromStart) : text.length }));
  const revealed = followText(stored, text, paced);
  if (revealed !== stored) setStored(revealed);

  const latest = useRef(revealed);
  const frame = useRef(0);
  useEffect(() => {
    latest.current = revealed;
  });
  useEffect(() => {
    if (!paced) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      return;
    }
    if (frame.current !== 0 || latest.current.shown >= latest.current.text.length) return;
    // Time counts from the loop's first frame: the frames before it can be long while the new text is laid out.
    let before: number | undefined;
    const tick = () => {
      // The time between renders, not rAF's frame timestamp: frames drawn right after new content come in quick pairs
      // whose timestamps lag their render, so a step would show two frames' time at once.
      const now = performance.now();
      const { text: target, shown } = latest.current;
      const next = { text: target, shown: revealStep(shown, target.length, now - (before ?? now)) };
      before = now;
      latest.current = next;
      // Rendered within the frame: left to React's scheduler, a step can land a frame late and two show as one.
      flushSync(() => setStored(next));
      frame.current = latest.current.shown < latest.current.text.length ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  }, [text, paced]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  return revealed.text.slice(0, Math.floor(revealed.shown));
};
