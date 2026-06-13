import { defineConfig } from "vitest/config"

// The whole testable surface lives in @lift/core (the shared "brain"). Tests
// import it through the workspace package's `exports` subpaths — the same way
// the two clients do — so they exercise the real public API, not internals.
//
// The core ships raw .ts (no build step); Vitest transpiles on the fly via
// esbuild, so there's nothing to compile first. Node-environment only: none
// of the core logic touches the DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each suite resets the singleton store in a beforeEach; keep files in
    // separate workers so module-level state never bleeds across suites.
    isolate: true,
    globals: false,
  },
})
