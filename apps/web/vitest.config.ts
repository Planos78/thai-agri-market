import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  // testTimeout 30s: LIVE_DB integration tests do many remote Supabase round-trips per case
  // (default 5s is too tight). DB-free unit tests finish in <10ms, so this is a no-op for them.
  test: { environment: "node", include: ["src/**/*.test.ts"], setupFiles: ["./vitest.setup.ts"], testTimeout: 30_000 },
});
