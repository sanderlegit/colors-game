import { beforeEach, describe, expect, it } from "vitest";
import type { ClientErrorReport } from "@/platform/errors";
import { describeThrown, installErrorReporter } from "@/platform/errors";

/**
 * The reporter runs inside a global error handler, which is the one place where
 * a bug is genuinely unobservable: nothing renders, nothing logs, and the
 * request that would have carried the news already succeeded. So the tests are
 * mostly about what it refuses to do — throw, flood, or repeat itself.
 *
 * The listeners are attached to an injected `EventTarget` rather than `window`,
 * so a test can dispatch a synthetic event without happy-dom's own error
 * handling getting involved.
 */

function sent(): {
  readonly send: (report: ClientErrorReport) => void;
  readonly all: ClientErrorReport[];
} {
  const all: ClientErrorReport[] = [];
  return { send: (report): void => void all.push(report), all };
}

/** happy-dom has `ErrorEvent`, but building the payload by hand keeps this honest. */
function errorEvent(error: unknown, message = ""): Event {
  const event = new Event("error");
  Object.assign(event, { error, message });
  return event;
}

function rejectionEvent(reason: unknown): Event {
  const event = new Event("unhandledrejection");
  Object.assign(event, { reason });
  return event;
}

describe("describing a thrown value", () => {
  it("keeps the name, the message and the stack of a real Error", () => {
    const error = new TypeError("nope");
    const described = describeThrown(error);
    expect(described.message).toBe("TypeError: nope");
    expect(described.stack).toContain("nope");
  });

  it("handles what `reject` actually gets called with", () => {
    // An unhandled rejection carries whatever was passed to `reject`, which is
    // routinely not an Error.
    expect(describeThrown("just a string")).toEqual({ message: "just a string", stack: null });
    expect(describeThrown(undefined)).toEqual({ message: "undefined", stack: null });
    expect(describeThrown(42)).toEqual({ message: "42", stack: null });
  });

  it("survives a value that cannot be stringified", () => {
    const hostile = {
      toString(): string {
        throw new Error("no");
      },
    };
    expect(describeThrown(hostile).message).toBe("unstringifiable rejection");
  });

  it("bounds both strings, because the server does too", () => {
    const long = new Error("x".repeat(5000));
    long.stack = "y".repeat(5000);
    const described = describeThrown(long);
    expect(described.message).toHaveLength(300);
    expect(described.stack).toHaveLength(2000);
  });
});

describe("the reporter", () => {
  let target: EventTarget;

  beforeEach(() => {
    target = new EventTarget();
  });

  it("reports a thrown error once", () => {
    const { send, all } = sent();
    installErrorReporter({ target, send });
    target.dispatchEvent(errorEvent(new Error("boom")));
    expect(all).toEqual([{ kind: "error", message: "Error: boom", stack: expect.any(String) }]);
  });

  it("reports an unhandled rejection", () => {
    const { send, all } = sent();
    installErrorReporter({ target, send });
    target.dispatchEvent(rejectionEvent(new Error("late")));
    expect(all[0]?.kind).toBe("unhandledrejection");
    expect(all[0]?.message).toBe("Error: late");
  });

  it("does not repeat itself, which is what the frame loop would otherwise do", () => {
    // A throw from inside the rAF loop fires sixty times a second. A reporter
    // without this is a denial-of-service tool aimed at our own database.
    const { send, all } = sent();
    installErrorReporter({ target, send });
    const error = new Error("every frame");
    for (let n = 0; n < 200; n += 1) target.dispatchEvent(errorEvent(error));
    expect(all).toHaveLength(1);
  });

  it("caps distinct errors per page load", () => {
    const { send, all } = sent();
    installErrorReporter({ target, send });
    for (let n = 0; n < 50; n += 1) target.dispatchEvent(errorEvent(new Error(`boom ${n}`)));
    expect(all).toHaveLength(5);
  });

  it("falls back to the message when the browser withholds the error", () => {
    // A cross-origin script gives `message` and nothing else.
    const { send, all } = sent();
    installErrorReporter({ target, send });
    target.dispatchEvent(errorEvent(null, "Script error."));
    expect(all[0]?.message).toBe("Script error.");
  });

  it("never lets a failing transport become the error", () => {
    installErrorReporter({
      target,
      send: (): void => {
        throw new Error("the beacon itself is broken");
      },
    });
    expect(() => target.dispatchEvent(errorEvent(new Error("boom")))).not.toThrow();
  });

  it("stops listening when torn down", () => {
    const { send, all } = sent();
    installErrorReporter({ target, send })();
    target.dispatchEvent(errorEvent(new Error("boom")));
    expect(all).toEqual([]);
  });
});
