/**
 * The bottom phase-action bar (SPEC §3, §5.4, §8; ADR 0027): one reserved slot,
 * in the thumb zone, that carries whatever the current phase asks of the player.
 *
 *   memorize → the countdown ring + numeric seconds (the five seconds are a rule,
 *              not decoration — SPEC §8)
 *   picking  → the Confirm button, with a spelled-out reason when it is disabled
 *   reveal   → the Next round / See summary button
 *
 * Exactly one of the three shows at a time, and the bar reserves its height so the
 * picker above it never resizes as the control changes — the memorize→picking
 * swatch rect is asserted identical in e2e (ADR 0027).
 *
 * There is no timer in here. The ring and the seconds are derived from
 * `memorizeProgress` / `memorizeRemainingMs`, which read the `now` the domain
 * already advanced — a `setInterval` alongside the reducer would be a second
 * clock, and two clocks disagree.
 */

import {
  isConfirmEnabled,
  isFinalRound,
  memorizeProgress,
  memorizeRemainingMs,
} from "@/domain/selectors";
import type { GameState } from "@/domain/state";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Ring geometry in the SVG's own 100×100 user space. */
const RING_RADIUS = 45;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** SPEC §5.4: why Confirm is off, in words rather than in a shade of gray. */
const CONFIRM_HINT = "Move the picker to enable";

export type ActionHandlers = {
  readonly onConfirm: () => void;
  readonly onNext: () => void;
};

export type ActionOptions = {
  /**
   * Pass `matchMedia("(prefers-reduced-motion: reduce)").matches` from the
   * composition root. SPEC §8: the ring stops animating, the numeric countdown
   * stays — the five seconds are a game rule, not decoration.
   */
  readonly reducedMotion?: boolean;
};

export type Action = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  destroy(): void;
};

function makeRingCircle(className: string): SVGCircleElement {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("class", className);
  circle.setAttribute("cx", "50");
  circle.setAttribute("cy", "50");
  circle.setAttribute("r", String(RING_RADIUS));
  return circle;
}

export function createAction(
  root: HTMLElement,
  handlers: ActionHandlers,
  options: ActionOptions = {},
): Action {
  const section = document.createElement("section");
  section.className = "action";

  const countdown = document.createElement("div");
  countdown.className = "action-countdown";

  const ring = document.createElementNS(SVG_NS, "svg");
  ring.setAttribute("class", "action-ring");
  ring.setAttribute("viewBox", "0 0 100 100");
  ring.setAttribute("aria-hidden", "true");
  const ringTrack = makeRingCircle("action-ring-track");
  const ringProgress = makeRingCircle("action-ring-progress");
  ringProgress.setAttribute("stroke-dasharray", RING_CIRCUMFERENCE.toFixed(3));
  ringProgress.setAttribute("stroke-dashoffset", "0");
  ring.append(ringTrack, ringProgress);

  const seconds = document.createElement("p");
  seconds.className = "action-seconds";
  seconds.setAttribute("role", "timer");
  seconds.textContent = "";

  countdown.append(ring, seconds);

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "action-confirm";
  confirm.textContent = "Confirm";

  const confirmHint = document.createElement("p");
  confirmHint.className = "action-confirm-hint";
  confirmHint.id = "action-confirm-hint";
  confirmHint.textContent = CONFIRM_HINT;
  confirm.setAttribute("aria-describedby", confirmHint.id);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "action-next";
  next.textContent = "Next round";

  section.append(countdown, confirm, confirmHint, next);
  root.append(section);

  let confirmEnabled = false;

  function onConfirmClick(): void {
    // The `disabled` attribute already blocks this in a browser; the guard keeps
    // a synthetic click in a test from doing what a real one cannot.
    if (!confirmEnabled) return;
    handlers.onConfirm();
  }
  function onNextClick(): void {
    handlers.onNext();
  }
  confirm.addEventListener("click", onConfirmClick);
  next.addEventListener("click", onNextClick);

  let renderedRing: string | null = null;
  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const reduced = options.reducedMotion === true || state.settings.reducedMotion;
    const memorizing = state.phase === "memorize";
    const picking = state.phase === "picking";
    const revealed = state.phase === "reveal";

    // The ring genuinely moves every frame, so it carries its own dirty check;
    // folding it into the main key would make everything else re-render at 60Hz.
    // Under reduced motion it is never written: a ring frozen at some arbitrary
    // sweep is decoration that misreports the time left.
    if (!reduced) {
      // Deplete clockwise — the visible arc is the fraction of time remaining.
      const dashOffset = (RING_CIRCUMFERENCE * memorizeProgress(state)).toFixed(3);
      if (dashOffset !== renderedRing) {
        renderedRing = dashOffset;
        ringProgress.setAttribute("stroke-dashoffset", dashOffset);
      }
    }

    const secondsLeft = memorizing ? String(Math.ceil(memorizeRemainingMs(state) / 1000)) : "";
    const enabled = isConfirmEnabled(state);
    const nextLabel = isFinalRound(state) ? "See summary" : "Next round";

    const key = `${memorizing ? "m" : ""}|${picking ? "p" : ""}|${revealed ? "r" : ""}|${
      secondsLeft
    }|${enabled ? "1" : "0"}|${nextLabel}|${reduced ? "R" : ""}`;
    if (key === renderedKey) return;
    renderedKey = key;

    countdown.hidden = !memorizing;
    seconds.textContent = secondsLeft;
    ring.setAttribute("class", reduced ? "action-ring is-static" : "action-ring");

    confirm.hidden = !picking;
    confirmHint.hidden = !picking || enabled;
    confirmEnabled = enabled;
    confirm.disabled = !enabled;
    confirm.setAttribute("aria-disabled", enabled ? "false" : "true");

    next.hidden = !revealed;
    next.textContent = nextLabel;
  }

  function destroy(): void {
    confirm.removeEventListener("click", onConfirmClick);
    next.removeEventListener("click", onNextClick);
    section.remove();
  }

  return { element: section, update, destroy };
}
