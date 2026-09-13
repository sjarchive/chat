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
};

async function handleNotify(request, env, ctx) {
  // Simple shared-secret check so random people on the internet can't
  // trigger pushes. Supabase's webhook sends this header value back.
  const secret = request.headers.get("x-notify-secret");
  if (secret !== env.NOTIFY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await request.json();
  const message = payload.record; // the newly inserted row, from Supabase's webhook

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
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Sender's name and the recipient's device list are independent — fetch
  // them in one parallel round trip instead of back-to-back awaits.
  const [senderRes, subsRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${message.sender_id}&select=display_name`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${message.recipient_id}`, { headers }),
  ]);

  let senderName = "Someone";
  try {
    const senderRows = await senderRes.json();
    senderName = senderRows[0]?.display_name || "Someone";
  } catch (e) {}
  let subscriptions = [];
  try {
    subscriptions = await subsRes.json();
  } catch (e) {}

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
      const subscription = {
        endpoint: sub.endpoint,
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
