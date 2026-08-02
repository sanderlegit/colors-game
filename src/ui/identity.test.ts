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
  const onForget = vi.fn();
  const block = createIdentity(root, { onClaim, onForget });

  return {
    root,
    block,
    onClaim,
    onForget,
    section: must(root.querySelector<HTMLElement>(".identity")),
    status: must(root.querySelector<HTMLElement>(".identity-status")),
    form: must(root.querySelector<HTMLFormElement>(".identity-form")),
    input: must(root.querySelector<HTMLInputElement>(".identity-input")),
    hint: must(root.querySelector<HTMLElement>(".identity-hint")),
    named: must(root.querySelector<HTMLElement>(".identity-named")),
    forget: must(root.querySelector<HTMLButtonElement>(".identity-forget")),
    collision: must(root.querySelector<HTMLElement>(".identity-collision")),
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
    block.setSubmission({ status: "done", name: null, requested: null, rank: 3 });

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

    block.setSubmission({ status: "done", name: null, requested: null, rank: 3 });
    block.setIdentity({ status: "anonymous" });
    expect(status.textContent).toBe("That puts you 3rd. Claim a name to appear on the board.");
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
      block.setSubmission({ status: "done", name: "ada", requested: null, rank });
      expect(status.textContent, String(rank)).toBe(`You are ${expected} on the board.`);
    }
  });

  it("says nothing about a rank it was not told (a claim from an older session)", () => {
    const { block, status } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });
    block.setSubmission({ status: "done", name: "ada", requested: "ada", rank: 0 });

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

  it("spells out a name collision rather than pretending the typed name landed", () => {
    const { block, collision } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada-2" });
    block.setSubmission({ status: "done", name: "ada-2", requested: "ada", rank: 3 });

    expect(collision.hidden).toBe(false);
    expect(collision.textContent).toBe("ada was taken, so you are ada-2.");
    expect([...collision.querySelectorAll("strong")].map((node) => node.textContent)).toEqual([
      "ada",
      "ada-2",
    ]);
  });

  it("stays quiet when the name landed as typed", () => {
    const { block, collision } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setSubmission({ status: "done", name: "ada", requested: "ada", rank: 3 });
    expect(collision.hidden).toBe(true);
  });

  it("shows who you are, with the form gone, once you have a name", () => {
    const { block, form, named } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    expect(named.hidden).toBe(false);
    expect(named.textContent).toContain("Playing as ada");
    expect(form.hidden).toBe(true);
  });

  it("needs two clicks to forget, and forgets on the second", () => {
    const { block, onForget, forget } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    forget.click();
    expect(onForget).not.toHaveBeenCalled();
    expect(forget.textContent).toBe("Really forget me?");

    forget.click();
    expect(onForget).toHaveBeenCalledTimes(1);
    expect(forget.textContent).toBe("Forget me");
  });

  it("disarms the forget button when it loses focus", () => {
    const { block, onForget, forget } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    forget.click();
    forget.dispatchEvent(new FocusEvent("blur"));
    expect(forget.textContent).toBe("Forget me");

    forget.click();
    expect(onForget).not.toHaveBeenCalled();
  });

  it("survives the frame loop: an armed button is not reset by an update", () => {
    const { block, forget } = setup();
    const summary = stateWith({ phase: "summary" });
    block.update(summary);
    block.setIdentity({ status: "named", name: "ada" });

    forget.click();
    block.update(summary);
    block.update(summary);

    expect(forget.textContent).toBe("Really forget me?");
  });

  it("removes itself and its listeners on destroy", () => {
    const { root, block, onForget, forget } = setup();
    block.update(stateWith({ phase: "summary" }));
    block.setIdentity({ status: "named", name: "ada" });

    block.destroy();
    forget.click();
    forget.click();

    expect(root.querySelector(".identity")).toBeNull();
    expect(onForget).not.toHaveBeenCalled();
  });
});
