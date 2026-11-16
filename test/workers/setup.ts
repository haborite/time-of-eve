import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

const DB = (env as unknown as { DB: D1Database }).DB;
await applyD1Migrations(DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);

// Storage persists within a test file: start every test from empty tables.
const TABLES = ["participants", "candidates", "polls", "audit_logs", "templates", "api_tokens", "sessions", "users", "settings", "login_attempts"];
beforeEach(async () => {
  await DB.batch(TABLES.map((t) => DB.prepare(`DELETE FROM ${t}`)));
});
