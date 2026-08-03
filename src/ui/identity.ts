/**
 * The username block on the summary screen (ADR 0011, ADR 0012, ADR 0025).
 *
 * It appears **only at `summary`**, because an identity is created by submitting
 * a score and never by arriving: a username form on the idle screen would be a
 * button that can only fail. Visibility is therefore derived from the phase,
 * which is why this component takes `update(state)` while the board does not.
 *
 * Two things a player can do here, both through the same form and the same
 * `POST /api/name`:
 *
 * - **Set a name** while `anonymous` — the first name after a game. It claims the
 *   games the player has not named yet (ADR 0032), including the one just played,
 *   so they appear on the board under the chosen name instead of a placeholder.
 * - **Change name** while `named` — "Change name" reveals the form pre-filled;
 *   submitting sets the prefill and names the current game (`setName`, ADR 0029,
 *   0032). It is not a new identity — but it does **not** move earlier games: the
 *   board reads each game's own name now, so past entries keep the name they were
 *   played under.
 *
 * There is **no forget/delete** here (ADR 0025): deletion is an operator action
 * (`just delete-player`), so the block never destroys anything.
 *
 * Client-side validation is non-empty-after-trim plus `maxlength`, and nothing
 * else. Mirroring the server's name rules here would drift, and the first symptom
 * is the client refusing a name the server would accept. Every other verdict is
 * the server's and is rendered back verbatim.
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
      readonly rank: number;
    }
  | { readonly status: "failed"; readonly message: string };

export type IdentityHandlers = {
  readonly onClaim: (name: string) => void;
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
 * (ADR 0015), so it only happens for a name set against an identity carried over
 * from an earlier session. Saying nothing beats inventing a place.
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
        ? `That puts you ${place}. Set a username to appear on the board.`
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

  const form = document.createElement("form");
  form.className = "identity-form";
  form.hidden = true;

  const label = document.createElement("label");
  label.className = "identity-label";
  label.htmlFor = "identity-name";

  const field = document.createElement("div");
  field.className = "identity-field";

  const input = document.createElement("input");
  input.className = "identity-input";
  input.id = "identity-name";
  input.name = "name";
  input.type = "text";
  input.autocomplete = "off";
  input.maxLength = MAX_NAME_LENGTH;

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "identity-claim";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "identity-cancel";
  cancel.textContent = "Cancel";
  cancel.hidden = true;

  const hint = document.createElement("p");
  hint.className = "identity-hint";

  field.append(input, submit, cancel);
  form.append(label, field, hint);

  const named = document.createElement("p");
  named.className = "identity-named";
  named.hidden = true;
  const nameValue = strong("");
  nameValue.className = "identity-name";
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "identity-rename";
  rename.textContent = "Change name";
  named.append(document.createTextNode("Playing as "), nameValue, document.createTextNode(" "));
  named.append(rename);

  section.append(status, form, named);
  root.append(section);

  let identity: PlayerIdentity = { status: "unknown" };
  let submission: SubmitState = { status: "idle" };
  let phase: GameState["phase"] = "idle";
  // True while a named player is editing their name. Anonymous first-set does not
  // use it — the form is already the only thing shown.
  let renaming = false;
  let renderedKey: string | null = null;

  function render(): void {
    // ADR 0011: identity is minted by submitting a score, so the block has
    // nothing to say anywhere but the summary.
    const visible = phase === "summary";
    const key = [
      visible ? "1" : "0",
      identity.status,
      identity.status === "named" ? identity.name : "",
      renaming ? "rename" : "",
      submission.status,
      statusLine(submission),
    ].join("|");
    if (key === renderedKey) return;
    renderedKey = key;

    section.hidden = !visible;
    if (!visible) return;

    status.textContent = statusLine(submission);

    const formVisible = identity.status === "anonymous" || renaming;
    form.hidden = !formVisible;
    label.textContent = renaming ? "Change your username" : "Set your username";
    submit.textContent = renaming ? "Save" : "Set username";
    cancel.hidden = !renaming;

    const sending = submission.status === "sending";
    input.disabled = sending;
    submit.disabled = sending;

    named.hidden = identity.status !== "named" || renaming;
    if (identity.status === "named") nameValue.textContent = identity.name;
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

  function onRename(): void {
    if (identity.status !== "named") return;
    renaming = true;
    input.value = identity.name;
    hint.textContent = "";
    render();
    input.focus();
    input.select();
  }

  function onCancel(): void {
    renaming = false;
    hint.textContent = "";
    input.value = "";
    render();
  }

  form.addEventListener("submit", onSubmit);
  rename.addEventListener("click", onRename);
  cancel.addEventListener("click", onCancel);

  function update(state: GameState): void {
    phase = state.phase;
    render();
  }

  function setIdentity(next: PlayerIdentity): void {
    // A new identity value is the answer to a set/rename (or a fresh load), so
    // editing is over and the input is cleared for its next use.
    identity = next;
    renaming = false;
    input.value = "";
    render();
  }

  function setSubmission(next: SubmitState): void {
    submission = next;
    render();
  }

  function destroy(): void {
    form.removeEventListener("submit", onSubmit);
    rename.removeEventListener("click", onRename);
    cancel.removeEventListener("click", onCancel);
    section.remove();
  }

  return { element: section, update, setIdentity, setSubmission, destroy };
}
