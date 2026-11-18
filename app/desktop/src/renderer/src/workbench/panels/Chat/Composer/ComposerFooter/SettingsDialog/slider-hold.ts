// Where the effort slider rests after a pick, pure: on the pick while its set is under way (the agent's value may pass
// through others meanwhile, as a resume restores the stored settings first), then until the agent's value moves off
// the one the pick was made on, or the set failed.

/** A committed pick: its index, the agent's value when it was made, and whether its set has answered. */
export type SliderHold = { index: number; from: unknown; settled: boolean };

/** Whether `hold` still decides the slider: its set is under way, or it answered without `failure` and the agent's value is still `from`. */
export const holds = (hold: SliderHold | undefined, current: unknown, failure: string | undefined): hold is SliderHold =>
  hold !== undefined && (!hold.settled || (failure === undefined && Object.is(hold.from, current)));

/** The slider's index: the drag's, else the held pick's, else the agent's value (`logged`). */
export const sliderIndex = (logged: number, dragging: number | undefined, hold: SliderHold | undefined, current: unknown, failure: string | undefined): number =>
  dragging ?? (holds(hold, current, failure) ? hold.index : logged);
