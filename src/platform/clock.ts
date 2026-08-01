/**
 * The Clock port's real adapter: a `requestAnimationFrame` loop.
 *
 * The tick carries the timestamp rAF hands us, never `Date.now()`. rAF's
 * timestamp is the frame's presentation time and is shared by every callback in
 * that frame, so the whole render pass sees one consistent `now`; sampling a
 * wall clock instead reintroduces the drift and non-determinism the domain layer
 * was built to avoid.
 *
 * `start` is idempotent and `stop` fully unschedules, so start/stop/start leaves
 * exactly one pending frame rather than a second loop nobody holds a handle to.
 */

export type Clock = {
  start(): void;
  stop(): void;
};

export type ClockOptions = {
  /** Injected in tests. Defaults to the platform `requestAnimationFrame`. */
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  /** Injected in tests. Defaults to the platform `cancelAnimationFrame`. */
  readonly cancelFrame?: (handle: number) => void;
};

export function createClock(onTick: (ms: number) => void, options: ClockOptions = {}): Clock {
  const requestFrame =
    options.requestFrame ??
    ((callback: FrameRequestCallback): number => requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number): void => {
      cancelAnimationFrame(handle);
    });

  let handle: number | null = null;

  function frame(ms: number): void {
    // Reschedule *before* the callback runs, so an `onTick` that calls `stop()`
    // cancels the frame it just caused rather than leaving one orphaned.
    handle = requestFrame(frame);
    onTick(ms);
  }

  return {
    start(): void {
      if (handle !== null) return;
      handle = requestFrame(frame);
    },
    stop(): void {
      if (handle === null) return;
      const pending = handle;
      handle = null;
      cancelFrame(pending);
    },
  };
}
