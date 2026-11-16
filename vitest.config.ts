import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects:
//  - workers: unit + integration tests inside workerd (Miniflare) with a local, per-test-isolated D1 and KV.
//  - node:    static checks over the source tree (e.g. every UI string has an English translation).
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc", environment: "" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                SECRET_KEY: "test-secret-key-0123456789abcdef0123456789abcdef",
                TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
                PUBLIC_ORIGIN: "https://toe.test",
                // per-IP rate limiting (Workers Rate Limiting binding) is skipped in tests; login throttling (D1) is tested
                ENVIRONMENT: "test",
              },
            },
          })),
        ],
        test: { name: "workers", include: ["test/workers/**/*.test.ts"], setupFiles: ["./test/workers/setup.ts"] },
      },
      { test: { name: "node", include: ["test/node/**/*.test.ts"], environment: "node" } },
    ],
  },
});
