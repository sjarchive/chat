// Custom worker entry for the OpenNext Cloudflare adapter.
//
// Re-exports the OpenNext-generated fetch handler and adds the scheduled
// cron handler (Supabase keep-alive). This is the documented "custom
// worker" pattern from the OpenNext docs; `wrangler.jsonc` points `main`
// at this file instead of `.open-next/worker.js`.
//
// @ts-ignore — .open-next/worker.js only exists after `opennextjs-cloudflare build`.
import worker from "./.open-next/worker.js";

interface CronEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

interface ScheduledContext {
  waitUntil(promise: Promise<void>): void;
}

export default {
  fetch: worker.fetch,

  // Cron trigger (see wrangler.jsonc `triggers.crons`).
  // Supabase pauses Free Plan projects that do not receive a few database
  // queries each day over a 7-day rolling window. Running every 6 hours
  // (4x/day) and querying multiple tables keeps Postgres actively engaged.
  async scheduled(_controller: unknown, env: CronEnv, ctx: ScheduledContext) {
    ctx.waitUntil(pingSupabase(env));
  },
};

async function pingSupabase(env: CronEnv): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Worker environment.");
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Cache-Control": "no-cache",
    Prefer: "count=exact",
  };

  // Query both tables in parallel so each scheduled run generates multiple
  // uncached PostgREST -> Postgres queries every 6 hours (8 DB queries/day).
  const endpoints = [
    `${env.SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`,
    `${env.SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint&limit=1`,
  ];

  const responses = await Promise.all(endpoints.map((endpoint) => fetch(endpoint, { headers })));

  for (const res of responses) {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase keep-alive query failed (${res.status}): ${body}`);
    }
  }
}
