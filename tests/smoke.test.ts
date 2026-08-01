import { expect, it } from "vitest";

// Placeholder so `vitest run` has at least one suite. Replace as real tests land.
it("has a working DOM environment", () => {
  const el = document.createElement("div");
  el.id = "app";
  document.body.append(el);

  expect(document.querySelector("#app")).not.toBeNull();
});
