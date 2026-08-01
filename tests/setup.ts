import { afterEach } from "vitest";

// Global test setup. `globals: false`, so every helper is imported explicitly.
// Keep DOM state from leaking between tests (environment: happy-dom).
afterEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style").forEach((node) => {
    node.remove();
  });
});
