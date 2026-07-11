import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Minimal Vitest config. Its only job is to resolve the app's `@/*` path alias
// (tsconfig: `@/* → ./*`) at test runtime, so pure modules can be tested through
// the same import specifiers the app uses (e.g. lib/doctors/schema.ts imports
// `@/lib/money`). Tests remain plain Node - no jsdom, no setup files.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
