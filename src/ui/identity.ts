/**
 * The name-claim block on the summary screen (ADR 0011, ADR 0012).
 *
 * It appears **only at `summary`**, because an identity is created by submitting
 * a score and never by arriving: a claim form on the idle screen would be a
 * button that can only fail. Visibility is therefore derived from the phase,
 * which is why this component takes `update(state)` while the board does not.
 *
 * Client-side validation is non-empty-after-trim plus `maxlength`, and nothing
 * else. Mirroring the server's name rules here would drift, and the first
 * symptom of the drift is the client refusing a name the server would have
 * accepted. Every other verdict is the server's and is rendered back verbatim.
 *
 * The form is shown when we *know* a claimable identity exists — `anonymous` —
 * rather than whenever a game ended. That is also what makes a rejected claim
 * retryable: the identity is still anonymous, so the form comes back with the
 * server's message above it.
 */

import type { GameState } from "@/domain/state";
import { MAX_NAME_LENGTH } from "@/platform/api";

export type PlayerIdentity =
  | { readonly status: "unknown" }
  | { readonly status: "anonymous" }
  | { readonly status: "named"; readonly name: string };

export type SubmitState =
  | { readonly status: "idle" }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "sending" }
  | {
      readonly status: "done";
      readonly name: string | null;
      readonly requested: string | null;
      readonly rank: number;
    }
  | { readonly status: "failed"; readonly message: string };

export type IdentityHandlers = {
  readonly onClaim: (name: string) => void;
  readonly onForget: () => void;
};

export type IdentityBlock = {
  readonly element: HTMLElement;
  update(state: GameState): void;
  setIdentity(identity: PlayerIdentity): void;
  setSubmission(submission: SubmitState): void;
  destroy(): void;
};

const SENDING = "Sending your score to the board…";
const EMPTY_NAME = "Type a name first.";
const FORGET = "Forget me";
const FORGET_ARMED = "Really forget me?";

/** 1st, 2nd, 3rd — with the teens, which every naive version gets wrong. */
function ordinal(rank: number): string {
  const teens = rank % 100;
  if (teens >= 11 && teens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * A rank of 0 means "not known here": the server ranks every submission
 * (ADR 0015), so it only happens for a name claimed against an identity carried
 * over from an earlier session. Saying nothing beats inventing a place.
 */
function statusLine(submission: SubmitState): string {
  switch (submission.status) {
    case "idle":
      return "";
    case "unavailable":
    case "failed":
      return submission.message;
    case "sending":
      return SENDING;
    case "done": {
      if (submission.rank <= 0) return "";
      const place = ordinal(submission.rank);
      return submission.name === null
        ? `That puts you ${place}. Claim a name to appear on the board.`
        : `You are ${place} on the board.`;
    }
  }
}

function strong(text: string): HTMLElement {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
}

export function createIdentity(root: HTMLElement, handlers: IdentityHandlers): IdentityBlock {
  const section = document.createElement("section");
  section.className = "identity";
  section.hidden = true;

  const status = document.createElement("p");
  status.className = "identity-status";
  status.setAttribute("role", "status");

  const collision = document.createElement("p");
  collision.className = "identity-collision";
  collision.hidden = true;

  const form = document.createElement("form");
  form.className = "identity-form";
  form.hidden = true;

  const label = document.createElement("label");
  label.className = "identity-label";
  label.htmlFor = "identity-name";
  label.textContent = "Claim a name for the board";

  const field = document.createElement("div");
  field.className = "identity-field";

  const input = document.createElement("input");
  input.className = "identity-input";
  input.id = "identity-name";
  input.name = "name";
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = MAX_NAME_LENGTH;

  const claim = document.createElement("button");
  claim.type = "submit";
  claim.className = "identity-claim";
  claim.textContent = "Claim";

  const hint = document.createElement("p");
  hint.className = "identity-hint";

  field.append(input, claim);
  form.append(label, field, hint);

  const named = document.createElement("p");
  named.className = "identity-named";
  named.hidden = true;
  const nameValue = strong("");
  nameValue.className = "identity-name";
  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "identity-forget";
  forget.textContent = FORGET;
  named.append(document.createTextNode("Playing as "), nameValue, document.createTextNode(" "));
  named.append(forget);

  section.append(status, collision, form, named);
  root.append(section);

  let identity: PlayerIdentity = { status: "unknown" };
  let submission: SubmitState = { status: "idle" };
  let phase: GameState["phase"] = "idle";
  let armed = false;
  let renderedKey: string | null = null;

  function renderForget(): void {
    forget.textContent = armed ? FORGET_ARMED : FORGET;
    forget.classList.toggle("is-armed", armed);
  }

  function renderCollision(): void {
    const done = submission.status === "done" ? submission : null;
    const requested = done?.requested ?? null;
    const landed = done?.name ?? null;
    if (requested === null || landed === null || requested === landed) {
      collision.hidden = true;
      return;
    }
    collision.replaceChildren(
      strong(requested),
      document.createTextNode(" was taken, so you are "),
      strong(landed),
      document.createTextNode("."),
    );
    collision.hidden = false;
  }

  function render(): void {
    // ADR 0011: identity is minted by submitting a score, so the block has
    // nothing to say anywhere but the summary.
    const visible = phase === "summary";
    const key = [
      visible ? "1" : "0",
      identity.status,
      identity.status === "named" ? identity.name : "",
      submission.status,
      statusLine(submission),
      submission.status === "done" ? `${submission.requested}>${submission.name}` : "",
    ].join("|");
    if (key === renderedKey) return;
    renderedKey = key;

    section.hidden = !visible;
    if (!visible) return;

    status.textContent = statusLine(submission);

    const sending = submission.status === "sending";
    form.hidden = identity.status !== "anonymous";
    input.disabled = sending;
    claim.disabled = sending;

    named.hidden = identity.status !== "named";
    if (identity.status === "named") nameValue.textContent = identity.name;

    renderCollision();
    renderForget();
  }

  function onSubmit(event: Event): void {
    event.preventDefault();
    const name = input.value.trim();
    if (name === "") {
      hint.textContent = EMPTY_NAME;
      input.focus();
      return;
    }
    hint.textContent = "";
    handlers.onClaim(name);
  }

  /**
   * Two clicks, not `window.confirm`: the dialog blocks the rAF loop the whole
   * game runs on. Arming reverts on blur, so a stray tap cannot leave a live
   * destructive button behind (ADR 0011).
   */
  function onForgetClick(): void {
    if (!armed) {
      armed = true;
      renderForget();
      return;
    }
    armed = false;
    renderForget();
    handlers.onForget();
  }

  function onForgetBlur(): void {
    if (!armed) return;
    armed = false;
    renderForget();
  }

  form.addEventListener("submit", onSubmit);
  forget.addEventListener("click", onForgetClick);
  forget.addEventListener("blur", onForgetBlur);

  function update(state: GameState): void {
    phase = state.phase;
    render();
  }

  function setIdentity(next: PlayerIdentity): void {
    identity = next;
    if (next.status !== "anonymous") input.value = "";
    render();
  }

  function setSubmission(next: SubmitState): void {
    submission = next;
    render();
  }

  function destroy(): void {
    form.removeEventListener("submit", onSubmit);
    forget.removeEventListener("click", onForgetClick);
    forget.removeEventListener("blur", onForgetBlur);
    section.remove();
  }

  return { element: section, update, setIdentity, setSubmission, destroy };
}
