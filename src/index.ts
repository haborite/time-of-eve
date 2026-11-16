/**
 * Worker entry point.
 *  - fetch: OAuth 2.1 authorization server (for MCP clients such as claude.ai / ChatGPT connectors) in front of the
 *    Hono app (src/app.tsx). See src/oauth.tsx.
 *  - scheduled (Cron Trigger, daily): retention of anonymous polls, expired sessions and login counters.
 */
import { app } from "./app";
import { db, PollStore } from "./repo/polls";
import { getSettings } from "./repo/settings";
import { purgeExpired } from "./repo/users";
import { oauthFetch } from "./oauth";
import type { Env } from "./http/context";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return oauthFetch(request, env, ctx, (req) => app.fetch(req, env, ctx));
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const d = db(env);
      await purgeExpired(d);
      const settings = await getSettings(d);
      if (settings.retention_days > 0) {
        const n = await new PollStore(d).purgeAnonymous(settings.retention_days);
        if (n) console.log(`retention: deleted ${n} anonymous poll(s) older than ${settings.retention_days} days`);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
