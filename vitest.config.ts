import { defineConfig } from "vitest/config";

// Tests cover the app's pure logic in lib/ (statement reading, merchant
// names, subscriptions, loans, card benefits, charts) -- no app or SQLite.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
