import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/domain/state";
import { initialState } from "@/domain/state";
import { MAX_NAME_LENGTH } from "@/platform/api";
import { createIdentity } from "@/ui/identity";

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function stateWith(patch: Partial<GameState>): GameState {
  return { ...initialState(), ...patch };
}

function setup() {
  const root = document.createElement("div");
  document.body.append(root);
  const onClaim = vi.fn<(name: string) => void>();
  const block = createIdentity(root, { onClaim });

  return {
    root,
    block,
    onClaim,
    section: must(root.querySelector<HTMLElement>(".identity")),
    status: must(root.querySelector<HTMLElement>(".identity-status")),
    form: must(root.querySelector<HTMLFormElement>(".identity-form")),
    input: must(root.querySelector<HTMLInputElement>(".identity-input")),
    hint: must(root.querySelector<HTMLElement>(".identity-hint")),
    named: must(root.querySelector<HTMLElement>(".identity-named")),
    rename: must(root.querySelector<HTMLButtonElement>(".identity-rename")),
    cancel: must(root.querySelector<HTMLButtonElement>(".identity-cancel")),
    claim: must(root.querySelector<HTMLButtonElement>(".identity-claim")),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createIdentity", () => {
  it("is invisible everywhere but the summary (ADR 0011)", () => {
    const { block, section } = setup();
    block.setIdentity({ status: "anonymous" });
    block.setSubmission({ status: "done", name: null, rank: 3 });

    for (const phase of ["idle", "memorize", "picking", "reveal"] as const) {
      block.update(stateWith({ phase }));
      expect(section.hidden, phase).toBe(true);
    }

    block.update(stateWith({ phase: "summary" }));
    expect(section.hidden).toBe(false);
  });

  it("says nothing at all until something has happened", () => {
    const { block, status, form, named } = setup();
    block.update(stateWith({ phase: "summary" }));

    expect(status.textContent).toBe("");
    expect(form.hidden).toBe(true);
    expect(named.hidden).toBe(true);
  });

  it("explains an unranked game instead of offering a submit that would fail", () => {
    const { block, status, form } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setSubmission({ status: "unavailable", message: "Played offline." });

    expect(status.textContent).toBe("Played offline.");
    expect(form.hidden).toBe(true);
  });

  it("reports the rank, and asks for a name only once one can be claimed", () => {
    const { block, status, form } = setup();
    block.update(stateWith({ phase: "summary" }));

    block.setSubmission({ status: "sending" });
    expect(status.textContent).toContain("Sending");
    // No identity yet, so no form: a claim would have nothing to attach to.
    expect(form.hidden).toBe(true);

    block.setSubmission({ status: "done", name: null, rank: 3 });
    block.setIdentity({ status: "anonymous" });
    expect(status.textContent).toBe("That puts you 3rd. Set a username to appear on the board.");
    expect(form.hidden).toBe(false);
  });

  it("gets the ordinals right, including the teens", () => {
    const { block, status } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    for (const [rank, expected] of [
      [1, "1st"],
      [2, "2nd"],
      [3, "3rd"],
      [4, "4th"],
      [11, "11th"],
      [12, "12th"],
      [13, "13th"],
      [21, "21st"],
      [112, "112th"],
    ] as const) {
      block.setSubmission({ status: "done", name: "ada", rank });
      expect(status.textContent, String(rank)).toBe(`You are ${expected} on the board.`);
    }
  });

  it("says nothing about a rank it was not told (a name set from an older session)", () => {
    const { block, status } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });
    block.setSubmission({ status: "done", name: "ada", rank: 0 });

    expect(status.textContent).toBe("");
  });

  it("validates only that the name is not blank, and passes it on trimmed", () => {
    const { block, onClaim, input, hint, claim } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "anonymous" });

    input.value = "   ";
    claim.click();
    expect(onClaim).not.toHaveBeenCalled();
    expect(hint.textContent).not.toBe("");

    input.value = "  ada  ";
    claim.click();
    expect(onClaim).toHaveBeenCalledWith("ada");
    expect(hint.textContent).toBe("");
  });

  it("submits with Enter, because the field is a real form", () => {
    const { block, onClaim, form, input } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "anonymous" });

    input.value = "ada";
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(onClaim).toHaveBeenCalledWith("ada");
    // Nothing navigates; a form that reloads the page would lose the game.
    expect(event.defaultPrevented).toBe(true);
  });

  it("takes its length limit from the API rather than a copy of the number", () => {
    const { input } = setup();
    expect(input.maxLength).toBe(MAX_NAME_LENGTH);
  });

  it("locks the form while a claim is in flight", () => {
    const { block, input } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "anonymous" });
    block.setSubmission({ status: "sending" });

    expect(input.disabled).toBe(true);
  });

  it("brings the form back with the server's verdict when a claim is refused", () => {
    const { block, status, form } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "anonymous" });
    block.setSubmission({ status: "failed", message: "That name is not allowed." });

    expect(status.textContent).toBe("That name is not allowed.");
    expect(form.hidden).toBe(false);
  });

  it("shows who you are, with a Change name button, once you have a name", () => {
    const { block, form, named, rename } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    expect(named.hidden).toBe(false);
    expect(named.textContent).toContain("Playing as ada");
    expect(rename.hidden).toBe(false);
    expect(form.hidden).toBe(true);
  });

  it("Change name reveals the form pre-filled with the current name (ADR 0025)", () => {
    const { block, form, named, input, claim, cancel, rename } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    rename.click();

    expect(form.hidden).toBe(false);
    expect(named.hidden).toBe(true);
    expect(input.value).toBe("ada");
    // The button and label say "change", not "set".
    expect(claim.textContent).toBe("Save");
    expect(cancel.hidden).toBe(false);
  });

  it("sends a rename through the same handler as the first set", () => {
    const { block, onClaim, input, claim, rename } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    rename.click();
    input.value = "Ada Lovelace";
    claim.click();

    expect(onClaim).toHaveBeenCalledWith("Ada Lovelace");
  });

  it("Cancel leaves rename without calling the handler and restores the name line", () => {
    const { block, onClaim, form, named, cancel, rename } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    rename.click();
    cancel.click();

    expect(onClaim).not.toHaveBeenCalled();
    expect(form.hidden).toBe(true);
    expect(named.hidden).toBe(false);
    expect(named.textContent).toContain("Playing as ada");
  });

  it("closes the rename form once the new name has landed", () => {
    const { block, form, named } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    block.setIdentity({ status: "named", name: "ada" });
    // The rename form is reopened, then the server answers with the new name.
    must(named.querySelector<HTMLButtonElement>(".identity-rename")).click();
    block.setIdentity({ status: "named", name: "Ada Lovelace" });

    expect(form.hidden).toBe(true);
    expect(named.textContent).toContain("Playing as Ada Lovelace");
  });

  it("removes itself and its listeners on destroy", () => {
    const { root, block, onClaim, rename } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    block.destroy();
    rename.click();

    expect(root.querySelector(".identity")).toBeNull();
    expect(onClaim).not.toHaveBeenCalled();
  });
});
