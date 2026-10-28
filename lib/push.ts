// ---------- Service worker + push notifications ----------
// Client side of the push pipeline: registers /sw.js, asks for notification
// permission once per user, and upserts the subscription into
// push_subscriptions for the Cloudflare worker to push to.

import { supabaseClient } from "./supabase";

// Public VAPID key — safe to expose in client code, this is the "public" half.
const VAPID_PUBLIC_KEY = import.meta.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

let pushSubscribeInFlight = false;
let pushSubscribedForUser: string | null = null;

// Sign-out removed this user's push subscription rows, so allow
// subscribeToPush to run again if they sign back in this session.
export function resetPushState(): void {
  pushSubscribedForUser = null;
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  userId: string
): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "denied") return;
  // Re-auth/token-refresh events fire this repeatedly for the same user;
  // permission was already asked (or the subscription already recorded) on
  // the first pass, so those re-runs would just prompt again for nothing.
  if (pushSubscribedForUser === userId || pushSubscribeInFlight) return;
  pushSubscribeInFlight = true;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    const keys = (json as { keys?: { p256dh?: string; auth?: string } }).keys;
    if (!json.endpoint || !keys?.p256dh || !keys?.auth) return;
    const { error } = await supabaseClient.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error(error);
      return;
    }
    pushSubscribedForUser = userId;
  } catch (err) {
    console.error(err);
  } finally {
    pushSubscribeInFlight = false;
  }
}

// Stop this browser from receiving push notifications once the user logs out.
// Without this, the push_subscriptions row (and the browser's own subscription)
// stays active forever, so the server keeps sending notifications even though
// nobody's logged in on this device anymore.
//
// Must run BEFORE auth.signOut(): deleting the rows needs the still-valid
// session for the table's row-level security to allow it.
export async function unsubscribeFromPush(userId: string | null | undefined): Promise<void> {
  try {
    // Cancel the browser-side subscription when we can find it. This alone
    // isn't relied on: it can come back null (permission revoked, or the
    // service worker hasn't finished registering right after a reload), and
    // any endpoint it misses would keep receiving pushes.
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) await subscription.unsubscribe();
    }

    // Delete every subscription row for this user, not just this device's
    // endpoint — stale rows from earlier logins would otherwise keep the
    // notifications coming. This is what actually stops the server sending.
    if (userId) {
      const { error } = await supabaseClient.from("push_subscriptions").delete().eq("user_id", userId);
      if (error) console.error(error);
    }
  } catch (err) {
    console.error(err);
  }
}
