import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry } from "@/platform/api";
import { FIXTURE_LEADERBOARD } from "@/platform/api.fixture";
import { createLeaderboard } from "@/ui/leaderboard";

function must<T extends Element>(element: T | null): T {
  if (element === null) throw new Error("expected element to exist");
  return element;
}

function setup(maxRows?: number) {
  const root = document.createElement("div");
  document.body.append(root);
  const onRetry = vi.fn();
  const board = createLeaderboard(root, { onRetry }, maxRows === undefined ? {} : { maxRows });
  return { root, board, onRetry };
}

function rows(root: HTMLElement): HTMLTableRowElement[] {
  return [...root.querySelectorAll<HTMLTableRowElement>(".leaderboard-body tr")];
}

function text(root: HTMLElement, selector: string): string {
  return must(root.querySelector(selector)).textContent ?? "";
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createLeaderboard", () => {
  it("says it is loading and shows no table yet", () => {
    const { root, board } = setup();
    board.setView({ status: "loading" });

    expect(text(root, ".leaderboard-status")).toContain("Loading");
    expect(must(root.querySelector<HTMLElement>(".leaderboard-table")).hidden).toBe(true);
    expect(must(root.querySelector<HTMLElement>(".leaderboard-retry")).hidden).toBe(true);
  });

  it("renders the server's message and a retry when the request fails", () => {
    const { root, board, onRetry } = setup();
    board.setView({ status: "error", message: "You are offline." });

    expect(text(root, ".leaderboard-status")).toBe("You are offline.");
    const retry = must(root.querySelector<HTMLButtonElement>(".leaderboard-retry"));
    expect(retry.hidden).toBe(false);
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("treats an empty board as a successful answer, not an error", () => {
    const { root, board } = setup();
    board.setView({ status: "ready", entries: [] });

    expect(must(root.querySelector<HTMLElement>(".leaderboard-retry")).hidden).toBe(true);
    expect(text(root, ".leaderboard-status")).toContain("Nobody has finished a game yet");
    expect(rows(root)).toHaveLength(0);
  });

  it("renders a real table with a caption and column headers", () => {
    const { root, board } = setup();
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });

    expect(root.querySelector("table.leaderboard-table caption")).not.toBeNull();
    const headers = [...root.querySelectorAll("thead th")];
    expect(headers).toHaveLength(3);
    for (const header of headers) expect(header.getAttribute("scope")).toBe("col");

    const first = must(rows(root)[0] ?? null);
    expect(must(first.querySelector(".leaderboard-rank")).textContent).toBe("1");
    expect(must(first.querySelector(".leaderboard-name")).textContent).toBe("grace");
    expect(must(first.querySelector(".leaderboard-score")).textContent).toBe("468");
    // The name is the row's header, which is what makes the row navigable.
    expect(must(first.querySelector(".leaderboard-name")).getAttribute("scope")).toBe("row");
  });

  it("marks your own row for assistive tech and in words, not by tint alone", () => {
    const { root, board } = setup();
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });

    const yours = rows(root).filter((row) => row.getAttribute("aria-current") === "true");
    expect(yours).toHaveLength(1);
    const row = must(yours[0] ?? null);
    expect(must(row.querySelector(".leaderboard-name")).textContent).toBe("ada (you)");
    expect(must(row.querySelector(".leaderboard-name .visually-hidden")).textContent).toBe(
      " (you)",
    );
  });

  it("rebuilds the rows on every view rather than appending to them", () => {
    const { root, board } = setup();
    const later: readonly LeaderboardEntry[] = [
      { rank: 1, name: "grace", score: 500, isYou: false },
    ];

    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
    board.setView({ status: "ready", entries: later });

    expect(rows(root)).toHaveLength(1);
    expect(must(rows(root)[0] ?? null).textContent).toContain("500");
  });

  it("drops the rows again when a later request is still in flight", () => {
    const { root, board } = setup();
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
    board.setView({ status: "loading" });
    expect(rows(root)).toHaveLength(0);
  });

  it("caps how many rows a response can turn into", () => {
    const { root, board } = setup(2);
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
    expect(rows(root)).toHaveLength(2);
  });

  it("removes itself and its listener on destroy", () => {
    const { root, board, onRetry } = setup();
    board.setView({ status: "error", message: "nope" });
    const retry = must(root.querySelector<HTMLButtonElement>(".leaderboard-retry"));

    board.destroy();
    retry.click();

    expect(root.querySelector(".leaderboard")).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
