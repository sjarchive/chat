// Minimal service worker — install-to-home-screen + push notifications.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------- IndexedDB ----------
// localStorage isn't available in service workers, so the page stashes the
// account's private key (as a JWK string) here — see crypto.js — for this
// worker to decrypt push notification previews on-device.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("circle-e2ee", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- push preview decryption (mirrors crypto.js — keep in sync) ----------
function b64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function unb64(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const NOTIFY_INFO = "circle-notify-v1";

// notify = base64(JSON { spk: sender public key, d: base64(iv || ct) })
// The message preview was encrypted by the sender's client to THIS device's
// key; the server that relayed the push never saw the text.
async function decryptNotify(notifyB64) {
  const jwkStr = await idbGet("private-key");
  if (!jwkStr) return null;

  const jwk = JSON.parse(jwkStr);
  const priv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: [] };
  const pubKey = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const myPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
  const myPubB64 = b64(myPubRaw);

  const { spk, d } = JSON.parse(new TextDecoder().decode(unb64(notifyB64)));
  const peerRaw = unb64(spk);
  const peer = await crypto.subtle.importKey("raw", peerRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256));
  const [p1, p2] = myPubB64 < b64(peerRaw) ? [myPubRaw, peerRaw] : [peerRaw, myPubRaw];
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", concatBytes(shared, p1, p2, new TextEncoder().encode(NOTIFY_INFO)))
  );
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);

  const blob = unb64(d);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12));
  return JSON.parse(new TextDecoder().decode(plain)).b || null;
}

// Show a notification when a push arrives — unless the chat is already
// open and focused in this browser, since the message will already show
// up live there via the realtime subscription.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // fall back to default text below
  }

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const chatIsOpenAndFocused = windowClients.some(
        (client) => client.focused && client.visibilityState === "visible"
      );
      if (chatIsOpenAndFocused) return;

      // The sender's client encrypted the message preview to this device's
      // key (worker.js relayed it unread). Legacy/missing previews fall back
      // to a generic text.
      let body = data.from ? `${data.from} sent you a message` : "You have a new message in Chat";
      if (data.enc) {
        try {
          const text = await decryptNotify(data.enc);
          if (text) body = text;
        } catch (e) {
          // wrong key / different account on this browser — keep generic text
        }
      }

      await self.registration.showNotification(data.title || "Chat", {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: "circle-message",
        renotify: true,
        data: { url: "/" },
      });
    })()
  );
});

// Clicking the notification focuses/opens the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
