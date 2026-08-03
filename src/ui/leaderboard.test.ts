import { beforeEach, describe, expect, it, vi } from "vitest";
import { oklch } from "@/color/types";
import type { LeaderboardEntry } from "@/platform/api";
import { FIXTURE_ATTEMPT, FIXTURE_LEADERBOARD } from "@/platform/api.fixture";
import type { LeaderboardHandlers } from "@/ui/leaderboard";
import { createLeaderboard } from "@/ui/leaderboard";

function must<T extends Element>(element: T | null | undefined): T {
  if (element === null || element === undefined) throw new Error("expected element to exist");
  return element;
}

function q<T extends Element>(parent: ParentNode, selector: string): T {
  return must(parent.querySelector<T>(selector));
}

function handlers(): LeaderboardHandlers {
  return {
    onRetry: vi.fn(),
    onExpand: vi.fn(),
    onShare: vi.fn(),
    onFilter: vi.fn(),
    onClearFilter: vi.fn(),
    onPlaySeed: vi.fn(),
    onViewChange: vi.fn(),
  };
}

function setup(maxRows?: number) {
  const root = document.createElement("div");
  document.body.append(root);
  const h = handlers();
  const board = createLeaderboard(root, h, maxRows === undefined ? {} : { maxRows });
  return { root, board, handlers: h };
}

/** Only the data rows — the interleaved detail rows are a different class. */
function rows(root: HTMLElement): HTMLTableRowElement[] {
  return [...root.querySelectorAll<HTMLTableRowElement>(".leaderboard-row")];
}

function details(root: HTMLElement): HTMLTableRowElement[] {
  return [...root.querySelectorAll<HTMLTableRowElement>(".leaderboard-detail")];
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

  it("has a Best-per-name / All-games toggle that reports changes (ADR 0033)", () => {
    const { root, handlers: h } = setup();
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="leaderboard-view"]')];
    expect(radios.map((r) => r.value)).toEqual(["best", "all"]);
    expect(radios[0]?.checked).toBe(true);
    const all = must(radios[1]);
    all.checked = true;
    all.dispatchEvent(new Event("change"));
    expect(h.onViewChange).toHaveBeenCalledWith("all");
  });

  it("renders the server's message and a retry when the request fails", () => {
    const { root, board, handlers } = setup();
    board.setView({ status: "error", message: "You are offline." });

    expect(text(root, ".leaderboard-status")).toBe("You are offline.");
    const retry = must(root.querySelector<HTMLButtonElement>(".leaderboard-retry"));
    expect(retry.hidden).toBe(false);
    retry.click();
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
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
    const columns = [...root.querySelectorAll("thead th")];
    expect(columns).toHaveLength(3);
    for (const header of columns) expect(header.getAttribute("scope")).toBe("col");

    const first = must(rows(root)[0] ?? null);
    expect(must(first.querySelector(".leaderboard-rank")).textContent).toBe("1");
    expect(must(first.querySelector(".leaderboard-name-text")).textContent).toBe("grace");
    expect(must(first.querySelector(".leaderboard-score")).textContent).toBe("468");
    // The name is still the row's header, which is what makes the row navigable.
    expect(must(first.querySelector(".leaderboard-name")).getAttribute("scope")).toBe("row");
  });

  it("marks your own row for assistive tech and in words, not by tint alone", () => {
    const { root, board } = setup();
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });

    const yours = rows(root).filter((row) => row.getAttribute("aria-current") === "true");
    expect(yours).toHaveLength(1);
    const row = must(yours[0] ?? null);
    expect(must(row.querySelector(".leaderboard-name-text")).textContent).toBe("ada");
    expect(must(row.querySelector(".leaderboard-name .visually-hidden")).textContent).toBe(
      " (you)",
    );
  });

  it("rebuilds the rows on every view rather than appending to them", () => {
    const { root, board } = setup();
    const later: readonly LeaderboardEntry[] = [
      { rank: 1, name: "grace", score: 500, isYou: false, gameId: "g_grace" },
    ];

    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
    board.setView({ status: "ready", entries: later });

    expect(rows(root)).toHaveLength(1);
    expect(must(rows(root)[0] ?? null).textContent).toContain("500");
  });

  it("caps how many rows a response can turn into", () => {
    const { root, board } = setup(2);
    board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
    expect(rows(root)).toHaveLength(2);
  });

  it("removes itself and its listener on destroy", () => {
    const { root, board, handlers } = setup();
    board.setView({ status: "error", message: "nope" });
    const retry = must(root.querySelector<HTMLButtonElement>(".leaderboard-retry"));

    board.destroy();
    retry.click();

    expect(root.querySelector(".leaderboard")).toBeNull();
    expect(handlers.onRetry).not.toHaveBeenCalled();
  });

  describe("expanding a row into its attempt", () => {
    function expandFirst(root: HTMLElement) {
      const expander = q<HTMLButtonElement>(must(rows(root)[0]), ".leaderboard-expander");
      expander.click();
      return { expander, detail: must(details(root)[0]) };
    }

    it("opens the detail row and asks the root to fetch it", () => {
      const { root, board, handlers } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });

      const { expander, detail } = expandFirst(root);
      expect(expander.getAttribute("aria-expanded")).toBe("true");
      expect(detail.hidden).toBe(false);
      expect(detail.classList.contains("is-open")).toBe(true);
      // The expander controls the detail row it reveals.
      expect(expander.getAttribute("aria-controls")).toBe(detail.id);
      expect(handlers.onExpand).toHaveBeenCalledWith("g_grace");
    });

    it("renders the pushed attempt as a breakdown with a chip per colour", () => {
      const { root, board } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      expandFirst(root);

      board.setAttempt("g_grace", { status: "ready", attempt: FIXTURE_ATTEMPT });

      const detail = must(details(root)[0]);
      expect(detail.querySelectorAll(".breakdown-round")).toHaveLength(5);
      // Two chips per round: target and guess.
      expect(detail.querySelectorAll(".breakdown-chip")).toHaveLength(10);
      expect(q(detail, ".attempt-total").textContent).toContain("412");
    });

    it("closes again when the row is clicked a second time", () => {
      const { root, board } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      const { expander, detail } = expandFirst(root);

      expander.click();
      expect(expander.getAttribute("aria-expanded")).toBe("false");
      expect(detail.hidden).toBe(true);
      expect(detail.classList.contains("is-open")).toBe(false);
    });

    it("closes from the panel's own close button", () => {
      const { root, board } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      expandFirst(root);
      board.setAttempt("g_grace", { status: "ready", attempt: FIXTURE_ATTEMPT });

      const detail = must(details(root)[0]);
      q<HTMLButtonElement>(detail, ".attempt-close").click();
      expect(detail.hidden).toBe(true);
    });

    it("lets several rows be open at once", () => {
      const { root, board } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      for (const row of rows(root)) {
        q<HTMLButtonElement>(row, ".leaderboard-expander").click();
      }
      expect(details(root).filter((d) => !d.hidden)).toHaveLength(3);
    });

    it("does not re-fetch an attempt it has already been given", () => {
      const { root, board, handlers } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      const expander = q<HTMLButtonElement>(must(rows(root)[0]), ".leaderboard-expander");

      expander.click(); // open → fetch
      board.setAttempt("g_grace", { status: "ready", attempt: FIXTURE_ATTEMPT });
      expander.click(); // close
      expander.click(); // open again → cached, no second fetch

      expect(handlers.onExpand).toHaveBeenCalledTimes(1);
      expect(must(details(root)[0]).querySelectorAll(".breakdown-round")).toHaveLength(5);
    });

    it("surfaces an attempt that failed to load without a breakdown", () => {
      const { root, board } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      expandFirst(root);

      board.setAttempt("g_grace", { status: "error", message: "The server had a problem." });
      const detail = must(details(root)[0]);
      expect(q(detail, ".attempt-status").textContent).toBe("The server had a problem.");
      expect(detail.querySelectorAll(".breakdown-round")).toHaveLength(0);
    });
  });

  describe("sharing and filtering", () => {
    function openPanel(root: HTMLElement) {
      q<HTMLButtonElement>(must(rows(root)[0]), ".leaderboard-expander").click();
      return must(details(root)[0]);
    }

    it("shares the game behind the row", () => {
      const { root, board, handlers } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      must(openPanel(root).querySelector<HTMLButtonElement>(".attempt-share")).click();
      expect(handlers.onShare).toHaveBeenCalledWith("g_grace");
    });

    it("asks to filter to the row's seed, carrying the player's name for the banner", () => {
      const { root, board, handlers } = setup();
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      must(openPanel(root).querySelector<HTMLButtonElement>(".attempt-filter")).click();
      expect(handlers.onFilter).toHaveBeenCalledWith("g_grace", "grace");
    });

    it("shows the seed banner, a back button, and play on a filtered board", () => {
      const { root, board, handlers } = setup();
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_grace", name: "grace" },
      });

      const banner = must(root.querySelector<HTMLElement>(".leaderboard-filter"));
      expect(banner.hidden).toBe(false);
      expect(must(root.querySelector<HTMLElement>(".leaderboard-back")).hidden).toBe(false);
      expect(text(root, ".leaderboard-caption")).toContain("seed");
      expect(text(root, ".leaderboard-play-seed")).toBe("Play set");

      must(root.querySelector<HTMLButtonElement>(".leaderboard-play-seed")).click();
      expect(handlers.onPlaySeed).toHaveBeenCalledWith("g_grace");
      must(root.querySelector<HTMLButtonElement>(".leaderboard-back")).click();
      expect(handlers.onClearFilter).toHaveBeenCalledTimes(1);
    });

    it("lists the seed's target colours once they are pushed in", () => {
      const { root, board } = setup();
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_grace", name: "grace" },
      });
      const colors = FIXTURE_ATTEMPT.rounds.map((round) => round.target);
      board.setFilterColors("g_grace", colors);

      const swatches = [...root.querySelectorAll<HTMLElement>(".leaderboard-seed-color")];
      expect(swatches).toHaveLength(colors.length);
      // The colour rides the custom property, not `background` — happy-dom drops
      // `oklch()` from the latter (see the file header of `swatch.ts`).
      expect(swatches[0]?.style.getPropertyValue("--fill-color")).not.toBe("");
    });

    it("ignores colours pushed for a seed that is no longer on show", () => {
      const { root, board } = setup();
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_grace", name: "grace" },
      });
      board.setFilterColors("g_someone_else", [oklch(0.6, 0.12, 30)]);

      expect(root.querySelectorAll(".leaderboard-seed-color")).toHaveLength(0);
    });

    it("hides the banner and back button on the global board", () => {
      const { root, board } = setup();
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_grace", name: "grace" },
      });
      board.setView({ status: "ready", entries: FIXTURE_LEADERBOARD });
      expect(must(root.querySelector<HTMLElement>(".leaderboard-filter")).hidden).toBe(true);
      expect(must(root.querySelector<HTMLElement>(".leaderboard-back")).hidden).toBe(true);
    });

    it("drops the previous seed's colours when the filter changes", () => {
      const { root, board } = setup();
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_grace", name: "grace" },
      });
      board.setFilterColors("g_grace", [oklch(0.6, 0.12, 30)]);
      board.setView({
        status: "ready",
        entries: FIXTURE_LEADERBOARD,
        filter: { gameId: "g_other", name: "other" },
      });
      expect(root.querySelectorAll(".leaderboard-seed-color")).toHaveLength(0);
    });
  });
});
