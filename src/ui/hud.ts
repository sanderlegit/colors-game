/**
 * Countdown, round counter and Confirm (SPEC §3, §5.4, §8).
 *
 * There is no timer in here. Both the ring and the numeric seconds are derived
 * from `memorizeProgress` / `memorizeRemainingMs`, which read the `now` the
 * domain already advanced — a `setInterval` alongside the reducer would be a
 * second clock, and two clocks disagree.
 */

import {
  isConfirmEnabled,
  memorizeProgress,
  memorizeRemainingMs,
  roundNumber,
} from "@/domain/selectors";
import type { GameState } from "@/domain/state";
import { ROUNDS_PER_GAME } from "@/domain/state";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Ring geometry in the SVG's own 100×100 user space. */
const RING_RADIUS = 45;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** SPEC §5.4: why Confirm is off, in words rather than in a shade of gray. */
const CONFIRM_HINT = "Move the picker to enable";

export type HudHandlers = {
  readonly onConfirm: () => void;
};

export type HudOptions = {
  /**
   * Pass `matchMedia("(prefers-reduced-motion: reduce)").matches` from the
   * composition root. SPEC §8: the ring stops animating, the numeric countdown
   * stays — the five seconds are a game rule, not decoration.
   */
  readonly reducedMotion?: boolean;
};

export type Hud = {
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

export function createHud(root: HTMLElement, handlers: HudHandlers, options: HudOptions = {}): Hud {
  const section = document.createElement("section");
  section.className = "hud";

  const roundLabel = document.createElement("p");
  roundLabel.className = "hud-round";

  const countdown = document.createElement("div");
  countdown.className = "hud-countdown";

  const ring = document.createElementNS(SVG_NS, "svg");
  ring.setAttribute("class", "hud-ring");
  ring.setAttribute("viewBox", "0 0 100 100");
  ring.setAttribute("aria-hidden", "true");
  const ringTrack = makeRingCircle("hud-ring-track");
  const ringProgress = makeRingCircle("hud-ring-progress");
  ringProgress.setAttribute("stroke-dasharray", RING_CIRCUMFERENCE.toFixed(3));
  ringProgress.setAttribute("stroke-dashoffset", "0");
  ring.append(ringTrack, ringProgress);

  const seconds = document.createElement("p");
  seconds.className = "hud-seconds";
  seconds.setAttribute("role", "timer");
  seconds.textContent = "";

  countdown.append(ring, seconds);

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "hud-confirm";
  confirm.textContent = "Confirm";

  const confirmHint = document.createElement("p");
  confirmHint.className = "hud-confirm-hint";
  confirmHint.id = "hud-confirm-hint";
  confirmHint.textContent = CONFIRM_HINT;
  confirm.setAttribute("aria-describedby", confirmHint.id);

  section.append(roundLabel, countdown, confirm, confirmHint);
  root.append(section);

  let confirmEnabled = false;

  function onClick(): void {
    // The `disabled` attribute already blocks this in a browser; the guard keeps
    // a synthetic click in a test from doing what a real one cannot.
    if (!confirmEnabled) return;
    handlers.onConfirm();
  }
  confirm.addEventListener("click", onClick);

  let renderedRing: string | null = null;
  let renderedKey: string | null = null;

  function update(state: GameState): void {
    const reduced = options.reducedMotion === true || state.settings.reducedMotion;
    const memorizing = state.phase === "memorize";
    const picking = state.phase === "picking";
    const showRound = state.phase !== "idle" && state.phase !== "summary";

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

    const round = showRound ? `Round ${roundNumber(state)} of ${ROUNDS_PER_GAME}` : "";
    const secondsLeft = memorizing ? String(Math.ceil(memorizeRemainingMs(state) / 1000)) : "";
    const enabled = isConfirmEnabled(state);

    const key = `${round}|${secondsLeft}|${reduced ? "r" : ""}|${picking ? "p" : ""}|${
      memorizing ? "m" : ""
    }|${enabled ? "1" : "0"}`;
    if (key === renderedKey) return;
    renderedKey = key;

    roundLabel.textContent = round;
    roundLabel.hidden = !showRound;

    countdown.hidden = !memorizing;
    seconds.textContent = secondsLeft;
    ring.setAttribute("class", reduced ? "hud-ring is-static" : "hud-ring");

    confirm.hidden = !picking;
    confirmHint.hidden = !picking || enabled;
    confirmEnabled = enabled;
    confirm.disabled = !enabled;
    confirm.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function destroy(): void {
    confirm.removeEventListener("click", onClick);
    section.remove();
  }

  return { element: section, update, destroy };
}
