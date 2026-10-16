import { buildPushPayload } from "@block65/webcrypto-web-push";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/notify" && request.method === "POST") {
      return handleNotify(request, env, ctx);
    }

    // Everything else: serve the static PWA files.
    return env.ASSETS.fetch(request);
  },

  // Cron trigger (see wrangler.jsonc `triggers.crons`).
  // Supabase pauses Free Plan projects that do not receive a few database
  // queries each day over a 7-day rolling window. Running every 6 hours
  // (4x/day) and querying multiple tables keeps Postgres actively engaged.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(pingSupabase(env));
  },
};

async function pingSupabase(env) {
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

  const responses = await Promise.all(
    endpoints.map((endpoint) => fetch(endpoint, { headers }))
  );

  for (const res of responses) {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase keep-alive query failed (${res.status}): ${body}`);
    }
  }
}

async function handleNotify(request, env, ctx) {
  // Simple shared-secret check so random people on the internet can't
  // trigger pushes. Supabase's webhook sends this header value back.
  const secret = request.headers.get("x-notify-secret");
  if (!env.NOTIFY_SECRET || secret !== env.NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
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

async function deliverPushes(message, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const senderIdParam = encodeURIComponent(message.sender_id);
  const recipientIdParam = encodeURIComponent(message.recipient_id);

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
  } catch (e) {}

  let subscriptions = [];
  try {
    if (subsRes.ok) {
      const parsed = await subsRes.json();
      if (Array.isArray(parsed)) subscriptions = parsed;
    }
  } catch (e) {}

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
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      const requestInit = await buildPushPayload(pushMessage, subscription, vapid);
      const res = await fetch(sub.endpoint, requestInit);

      // 404/410 means the subscription is dead — clean it up
      if (res.status === 404 || res.status === 410) {
        await fetch(
          `${env.SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
          {
            method: "DELETE",
            headers,
          }
        );
      }
    })
  );
}