// ---------- End-to-end encryption (E2EE) ----------
// Built on the browser's native WebCrypto — no external dependency.
//
// Model:
//   Every user has an ECDH P-256 keypair. The public key is published in
//   profiles.public_key; the private key lives on the device (localStorage)
//   and is ALSO stored in profiles.enc_private_key wrapped with a key derived
//   from the login password (PBKDF2), so a new device can recover it at
//   login. That is why the password must be typed once per device — Supabase
//   never sees the unwrapped key, but does see the password at login, which
//   is the documented limit of this threat model.
//
// Messages:
//   The payload {b: text, mk: media key, mi: media iv} is encrypted once for
//   the recipient (ECDH(sender, recipient)) and once for the sender's own
//   other devices (ECDH(sender, sender)), and stored in messages.body as
//   "enc:v1:{json}" (the prefix keeps legacy plaintext rows readable).
//   Photos are encrypted with a random AES-GCM key before upload; that key
//   travels inside the encrypted payload, so Storage only holds ciphertext.
//
// Push previews:
//   The sender additionally encrypts the notification preview to the
//   recipient and stores it in messages.notify. The Cloudflare worker relays
//   it unread; sw.js decrypts it on the phone. The server never sees text.

const CircleCrypto = (() => {
  const PREFIX = "enc:v1:"; // marker identifying encrypted message bodies
  const LS_KEY = "circle-e2ee-key:"; // + user id → private key JWK on this device
  const MSG_INFO = "circle-msg-v1"; // key-derivation labels; must match sw.js
  const NOTIFY_INFO = "circle-notify-v1";
  const IDB_NAME = "circle-e2ee";
  const IDB_STORE = "kv";

  let myUserId = null;
  let myPriv = null; // CryptoKey (ECDH private)
  let myPubRaw = null; // Uint8Array, raw public key
  let myPubB64 = null; // same, base64

  const pubKeyCache = {}; // userId -> base64 public key
  // "peerB64|info" -> derived CryptoKey. The derivation is deterministic for a
  // given (my key, peer key, purpose label), so caching it turns every seal/
  // unseal after the first into a single AES-GCM call instead of a full ECDH
  // round trip per message. Cleared whenever a different private key is
  // adopted (sign-in as another user), which invalidates every entry.
  const aesKeyCache = {};

  // ---------- encoding helpers ----------
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

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  // ---------- IndexedDB (shares the key with the service worker) ----------
  // localStorage isn't available inside a service worker, so the page stashes
  // the private key JWK there for sw.js to read when a push arrives.
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- key management ----------
  async function pubRawFromJwk(jwk) {
    // The public half is embedded in the private JWK (x/y coords).
    const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true, key_ops: [] };
    const pub = await crypto.subtle.importKey("jwk", pubJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
    return new Uint8Array(await crypto.subtle.exportKey("raw", pub));
  }

  async function adoptKey(userId, jwk) {
    myUserId = userId;
    myPriv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    myPubRaw = await pubRawFromJwk(jwk);
    myPubB64 = b64(myPubRaw);
    // Keys derived under the previous private key are no longer valid.
    for (const k of Object.keys(aesKeyCache)) delete aesKeyCache[k];
  }

  async function fetchPublicKey(userId) {
    if (pubKeyCache[userId]) return pubKeyCache[userId];
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("public_key")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data || !data.public_key) return null;
    pubKeyCache[userId] = data.public_key;
    return pubKeyCache[userId];
  }

  async function passwordWrapKey(password, userId, usages) {
    const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: encoder.encode("circle-e2ee:" + userId), iterations: 310000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      usages
    );
  }

  // Unlocks (or first-time creates) this account's keypair. The password is
  // only required the first time on a given device; afterwards the key is
  // cached in localStorage and refreshes skip straight past this.
  // Returns true when this device can encrypt/decrypt.
  async function setupKeys(userId, password) {
    try {
      const cached = localStorage.getItem(LS_KEY + userId);
      if (cached) {
        await adoptKey(userId, JSON.parse(cached));
        await idbPut("private-key", cached);
        return true;
      }

      let jwk = null;
      const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("public_key, enc_private_key")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;

      if (profile && profile.enc_private_key && password) {
        // Recovering the key on a new device: unwrap the stored blob with the
        // login password. Auth already verified the password is correct, so a
        // failure here means the blob itself is unusable.
        const blob = JSON.parse(decoder.decode(unb64(profile.enc_private_key)));
        const wrapKey = await passwordWrapKey(password, userId, ["decrypt"]);
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, wrapKey, unb64(blob.ct));
        jwk = JSON.parse(decoder.decode(plain));
      } else if (password) {
        // First login since E2EE was enabled (new or pre-existing account):
        // generate a keypair, publish the public half, and store the private
        // half wrapped with the password so other devices can recover it.
        const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
        jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
        const publishedPub = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
        const wrapKey = await passwordWrapKey(password, userId, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, encoder.encode(JSON.stringify(jwk)));
        const wrapped = b64(encoder.encode(JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) })));
        const { error: upErr } = await supabaseClient
          .from("profiles")
          .update({ public_key: publishedPub, enc_private_key: wrapped })
          .eq("id", userId);
        if (upErr) throw upErr;
        pubKeyCache[userId] = publishedPub;
      } else {
        // Session restored (refresh) without a local key and no password in
        // hand — can't unlock. The caller degrades gracefully to plaintext.
        return false;
      }

      const jwkStr = JSON.stringify(jwk);
      await adoptKey(userId, jwk);
      localStorage.setItem(LS_KEY + userId, jwkStr);
      await idbPut("private-key", jwkStr);
      return true;
    } catch (err) {
      console.error("E2EE key setup failed:", err);
      return false;
    }
  }

  function ready() {
    return !!myPriv;
  }

  // Lets the page prime the cache with public keys it already fetched.
  function cachePublicKey(userId, publicKeyB64) {
    if (publicKeyB64) pubKeyCache[userId] = publicKeyB64;
  }

  // ---------- primitives ----------
  // AES-GCM key from the ECDH shared secret, bound to both public keys and a
  // purpose label. Mirrored in sw.js for push previews — keep in sync.
  async function aesKeyFor(peerRawBytes, info) {
    const peerB64 = b64(peerRawBytes);
    const cacheId = peerB64 + "|" + info;
    const cached = aesKeyCache[cacheId];
    if (cached) return cached;
    const peer = await crypto.subtle.importKey("raw", peerRawBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, myPriv, 256));
    const [p1, p2] = myPubB64 < peerB64 ? [myPubRaw, peerRawBytes] : [peerRawBytes, myPubRaw];
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", concatBytes(shared, p1, p2, encoder.encode(info)))
    );
    const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    aesKeyCache[cacheId] = key;
    return key;
  }

  async function seal(peerRaw, obj, info) {
    const key = await aesKeyFor(peerRaw, info);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(obj))));
    return b64(concatBytes(iv, ct));
  }

  async function unseal(peerRaw, blobB64, info) {
    const raw = unb64(blobB64);
    const key = await aesKeyFor(peerRaw, info);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
    return JSON.parse(decoder.decode(plain));
  }

  // ---------- outgoing ----------
  // payload: { b: plaintext|null, mk: mediaKeyB64|null, mi: mediaIvB64|null }
  // preview: short notification text ("hello" / "📷 Photo").
  // Returns { body, notify }, or null when the recipient has no published key
  // (caller falls back to a legacy plaintext row so nothing is lost).
  async function encryptOutgoing(partnerId, payload, preview) {
    if (!ready()) return null;
    const partnerPub = await fetchPublicKey(partnerId);
    if (!partnerPub) return null;
    const partnerRaw = unb64(partnerPub);
    // The three seals are independent — run them concurrently instead of
    // chaining three sequential crypto round trips on the send path.
    const [r, s, notifySeal] = await Promise.all([
      seal(partnerRaw, payload, MSG_INFO), // readable by the recipient
      seal(myPubRaw, payload, MSG_INFO), // readable by my own devices
      seal(partnerRaw, { b: preview }, NOTIFY_INFO),
    ]);
    const container = {
      v: 1,
      k: myPubB64, // sender's public key — the recipient needs it to derive the key
      r,
      s,
    };
    const notify = b64(encoder.encode(JSON.stringify({ spk: myPubB64, d: notifySeal })));
    return { body: PREFIX + JSON.stringify(container), notify };
  }

  // ---------- incoming ----------
  // Turns a raw row into a "view": body decrypted, media key/iv attached.
  // Legacy plaintext rows pass through untouched (_encrypted: false).
  async function decryptRow(row) {
    if (!row || typeof row.body !== "string" || !row.body.startsWith(PREFIX)) {
      return Object.assign({}, row, { _encrypted: false });
    }
    try {
      const container = JSON.parse(row.body.slice(PREFIX.length));
      const mine = container.k === myPubB64; // my own message (another device)?
      const peerRaw = mine ? myPubRaw : unb64(container.k);
      const payload = await unseal(peerRaw, mine ? container.s : container.r, MSG_INFO);
      return Object.assign({}, row, {
        body: payload.b || "",
        _encrypted: true,
        _mk: payload.mk || null,
        _mi: payload.mi || null,
      });
    } catch (err) {
      return Object.assign({}, row, { body: "🔒 Can't decrypt this message", _encrypted: true });
    }
  }

  // ---------- media ----------
  // Encrypts an image before upload; the AES key/iv travel inside the
  // encrypted message payload.
  async function encryptFileForSend(file) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer());
    return {
      data: new Blob([ct], { type: "application/octet-stream" }),
      mk: b64(await crypto.subtle.exportKey("raw", key)),
      mi: b64(iv),
    };
  }

  // Fetches ciphertext from Storage and decrypts to an object URL.
  async function decryptMedia(mediaPath, mkB64, miB64, mime) {
    try {
      const url = supabaseClient.storage.from("chat-media").getPublicUrl(mediaPath).data.publicUrl;
      const res = await fetch(url);
      if (!res.ok) return null;
      const key = await crypto.subtle.importKey("raw", unb64(mkB64), { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(miB64) }, key, await res.arrayBuffer());
      return URL.createObjectURL(new Blob([plain], { type: mime || "application/octet-stream" }));
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  return { setupKeys, ready, cachePublicKey, encryptOutgoing, decryptRow, encryptFileForSend, decryptMedia };
})();
