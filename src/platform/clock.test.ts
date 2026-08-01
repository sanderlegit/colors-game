import { describe, expect, it, vi } from "vitest";
import { createClock } from "@/platform/clock";

/**
 * A hand-driven `requestAnimationFrame`. Real rAF would make these tests wait on
 * a compositor and would hide exactly the bug worth catching — a second loop
 * running alongside the first.
 */
function fakeRaf(): {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  pending: () => number;
  flush: (ms: number) => void;
} {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 0;

  return {
    requestFrame(callback: FrameRequestCallback): number {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    },
    cancelFrame(handle: number): void {
      callbacks.delete(handle);
    },
    pending(): number {
      return callbacks.size;
    },
    flush(ms: number): void {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback(ms);
    },
  };
}

describe("createClock", () => {
  it("does not tick until started", () => {
    const raf = fakeRaf();
    const onTick = vi.fn();
    createClock(onTick, raf);

    raf.flush(16);
    expect(onTick).not.toHaveBeenCalled();
    expect(raf.pending()).toBe(0);
  });

  it("passes the frame timestamp through, not a wall clock", () => {
    const raf = fakeRaf();
    const onTick = vi.fn();
    const clock = createClock(onTick, raf);

    clock.start();
    raf.flush(1234.5);
    raf.flush(1250.5);

    expect(onTick.mock.calls).toEqual([[1234.5], [1250.5]]);
  });

  it("keeps exactly one frame in flight", () => {
    const raf = fakeRaf();
    const clock = createClock(() => {}, raf);

    clock.start();
    clock.start();
    clock.start();
    expect(raf.pending()).toBe(1);

    raf.flush(16);
    expect(raf.pending()).toBe(1);
  });

  it("stops without leaving a frame scheduled", () => {
    const raf = fakeRaf();
    const onTick = vi.fn();
    const clock = createClock(onTick, raf);

    clock.start();
    raf.flush(16);
    clock.stop();

    expect(raf.pending()).toBe(0);
    raf.flush(32);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("restarts without leaking the previous loop", () => {
    const raf = fakeRaf();
    const onTick = vi.fn();
    const clock = createClock(onTick, raf);

    clock.start();
    raf.flush(16);
    clock.stop();
    clock.start();
    expect(raf.pending()).toBe(1);

    raf.flush(32);
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(raf.pending()).toBe(1);
  });

  it("stops cleanly when the tick handler itself stops the clock", () => {
    const raf = fakeRaf();
    const onTick = vi.fn(() => {
      clock.stop();
    });
    const clock = createClock(onTick, raf);

    clock.start();
    raf.flush(16);

    // The frame scheduled just before the callback ran must be cancelled too.
    expect(raf.pending()).toBe(0);
    raf.flush(32);
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("ignores a redundant stop", () => {
    const raf = fakeRaf();
    const clock = createClock(() => {}, raf);

    clock.stop();
    clock.start();
    clock.stop();
    clock.stop();

    expect(raf.pending()).toBe(0);
  });
});
