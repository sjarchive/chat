import { buildPushPayload } from "@block65/webcrypto-web-push";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/notify" && request.method === "POST") {
      return handleNotify(request, env);
    }

    // Everything else: serve the static PWA files.
    return env.ASSETS.fetch(request);
  },
};

async function handleNotify(request, env) {
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

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Look up the sender's name
  const senderRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${message.sender_id}&select=display_name`,
    { headers }
  );
  const senderRows = await senderRes.json();
  const senderName = senderRows[0]?.display_name || "Someone";

  // Direct messages: only the recipient's devices get a push
  const subsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${message.recipient_id}`,
    { headers }
  );
  const subscriptions = await subsRes.json();

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

  const results = await Promise.allSettled(
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

  return new Response(JSON.stringify({ sent: results.length }), {
    headers: { "Content-Type": "application/json" },
  });
}
