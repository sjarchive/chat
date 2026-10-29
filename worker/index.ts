// Cloudflare Worker — the whole deployed program. Two jobs:
//
//   1. fetch — serve the Vite-built single-page app (assets-first routing:
//      anything matching a file in dist/ is served directly by the platform,
//      everything else falls through to here and gets the app shell), plus
//      POST /api/notify — the push-notification relay (port of the old
//      Worker's handleNotify/deliverPushes; Supabase's database webhook calls
//      it on every new message and it fans the already-E2EE-encrypted
//      notification payload out to the recipient's registered devices).
//   2. scheduled — the Supabase keep-alive cron.
//
// Runtime env/secrets come from the Cloudflare bindings (wrangler secrets in
// production, .dev.vars in local dev), and background delivery uses waitUntil
// so the webhook gets an instant response.

import { buildPushPayload } from "@block65/webcrypto-web-push";

interface Env {
  /** Static assets binding — the built client in dist/. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NOTIFY_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

interface ScheduledContext {
  waitUntil(promise: Promise<void>): void;
}

interface SubRow {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ScheduledContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/notify") return handleNotify(request, env, ctx);
    // Any other path serves the single-page app shell.
    const res = await env.ASSETS.fetch(new Request(new URL("/", request.url)));

    // Inject a preconnect hint into the shell: the browser can then overlap
    // the Supabase origin's DNS+TCP+TLS handshake with the JS bundle
    // download/parse, trimming ~100-300ms off the first REST call and the
    // realtime websocket join that follow. crossOrigin matters — REST/auth
    // calls are CORS requests, and only a CORS-mode preconnect's connection
    // can be reused for them.
    if (env.SUPABASE_URL && res.headers.get("content-type")?.includes("text/html")) {
      try {
        const apiOrigin = new URL(env.SUPABASE_URL).origin;
        const html = await res.text();
        const hint = `<link rel="preconnect" href="${apiOrigin}" crossorigin />\n    `;
        const injected = html.replace("</head>", `${hint}</head>`);
        if (injected !== html) {
          const headers = new Headers(res.headers);
          // The body is now our own re-serialized string; stale storage
          // metadata would truncate it.
          headers.delete("content-length");
          headers.delete("content-encoding");
          return new Response(injected, { status: res.status, headers });
        }
      } catch {
        // Fall through — serving the shell unchanged beats failing on it.
      }
    }
    return res;
  },

  // Cron trigger (see wrangler.jsonc `triggers.crons`).
  // Supabase pauses Free Plan projects that do not receive a few database
  // queries each day over a 7-day rolling window. Running every 6 hours
  // (4x/day) and querying multiple tables keeps Postgres actively engaged.
  async scheduled(_controller: unknown, env: Env, ctx: ScheduledContext) {
    ctx.waitUntil(pingSupabase(env));
  },
};

async function handleNotify(request: Request, env: Env, ctx: ScheduledContext): Promise<Response> {
  // Simple shared-secret check so random people on the internet can't
  // trigger pushes. Supabase's webhook sends this header value back.
  const secret = request.headers.get("x-notify-secret");
  if (!env.NOTIFY_SECRET || secret !== env.NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = payload?.record; // the newly inserted row, from Supabase's webhook

  if (!message || !message.sender_id || !message.recipient_id) {
    return new Response("Bad request", { status: 400 });
  }

  // Acknowledge instantly and dispatch the pushes in the background. The
  // Supabase webhook blocks on this response before it considers the job
  // done — waiting for every push service round trip here added that whole
  // delivery time to the webhook itself for no benefit: push delivery is
  // already asynchronous from the recipient's point of view.
  ctx.waitUntil(deliverPushes(message, env));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function deliverPushes(message: { sender_id?: string; recipient_id?: string; notify?: string | null }, env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const senderIdParam = encodeURIComponent(message.sender_id ?? "");
  const recipientIdParam = encodeURIComponent(message.recipient_id ?? "");

  // Sender's name and the recipient's device list are independent — fetch
  // them in one parallel round trip instead of back-to-back awaits.
  const [senderRes, subsRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${senderIdParam}&select=display_name`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${recipientIdParam}`, { headers }),
  ]);

  let senderName = "Someone";
  try {
    if (senderRes.ok) {
      const senderRows = await senderRes.json();
      if (Array.isArray(senderRows) && senderRows[0]?.display_name) {
        senderName = senderRows[0].display_name;
      }
    }
  } catch {}

  let subscriptions: SubRow[] = [];
  try {
    if (subsRes.ok) {
      const parsed = await subsRes.json();
      if (Array.isArray(parsed)) subscriptions = parsed;
    }
  } catch {}

  if (subscriptions.length === 0) return;

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  // End-to-end encrypted: the sender's client stored an encrypted preview in
  // messages.notify; this server can't read it — sw.js decrypts it on the
  // recipient's device. Rows without one (sent before E2EE, or to a user who
  // hasn't logged in since) get generic text with the sender's name, which
  // is public metadata in profiles anyway.
  const pushMessage = {
    data: JSON.stringify({
      title: "Chat",
      enc: message.notify || null,
      from: senderName,
    }),
    options: { ttl: 60 },
  };

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) return;
      const subscription = {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      const requestInit = await buildPushPayload(pushMessage, subscription, vapid);
      const res = await fetch(sub.endpoint, requestInit);

      // 404/410 means the subscription is dead — clean it up
      if (res.status === 404 || res.status === 410) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
          headers,
        });
      }
    })
  );
}

async function pingSupabase(env: Env): Promise<void> {
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
