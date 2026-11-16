import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes SQL migrations into ./migrations; Wrangler applies them
// (`npm run db:migrate:local|staging|production`). Hand-written SQL (triggers) goes into its own migration file.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
