// ---------- Elements ----------
const authScreen = document.getElementById("auth-screen");
const chatsScreen = document.getElementById("chats-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authFullname = document.getElementById("auth-fullname");
const authName = document.getElementById("auth-name");
const authPassword = document.getElementById("auth-password");
const passwordToggle = document.getElementById("password-toggle");
const passwordToggleIcon = document.getElementById("password-toggle-icon");
const authSubmit = document.getElementById("auth-submit");
const authToggle = document.getElementById("auth-toggle");
const authError = document.getElementById("auth-error");
const chatList = document.getElementById("chat-list");
const userSearch = document.getElementById("user-search");
const searchResults = document.getElementById("search-results");
const backButton = document.getElementById("back-button");
const chatPartnerName = document.getElementById("chat-partner-name");
const partnerPresence = document.getElementById("partner-presence");
const messageList = document.getElementById("message-list");
const composer = document.getElementById("composer");
const messageInput = document.getElementById("message-input");
const attachButton = document.getElementById("attach-button");
const attachInput = document.getElementById("attach-input");
const signOutBtn = document.getElementById("sign-out");
const jumpBottom = document.getElementById("jump-bottom");
const jumpBottomCount = document.getElementById("jump-bottom-count");
const typingIndicator = document.getElementById("typing-indicator");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const replyPreview = document.getElementById("reply-preview");
const replyPreviewName = document.getElementById("reply-preview-name");
const replyPreviewText = document.getElementById("reply-preview-text");
const replyPreviewCancel = document.getElementById("reply-preview-cancel");
const settingsButtons = [document.getElementById("settings-button")];
const settingsOverlay = document.getElementById("settings-overlay");
const settingsName = document.getElementById("settings-name");
const settingsError = document.getElementById("settings-error");
const settingsSave = document.getElementById("settings-save");
const settingsCancel = document.getElementById("settings-cancel");
const composerError = document.getElementById("composer-error");
const chatPlaceholder = document.getElementById("chat-placeholder");

let isSignUpMode = false;

// ---------- Delivery ticks ----------
// WhatsApp Web's own check icons (msg-check / msg-dcheck), inlined as SVG and
// painted with currentColor. Unicode "✓" text was rendering with whatever
// font each device fell back to, so it looked different per browser/platform;
// SVG paths render pixel-identically everywhere. The double tick is the same
// path drawn twice — the right check offset down and to the right, exactly as
// WhatsApp draws it.
const TICK_PATH =
  "M10.91 3.316l-.478-.372a.365.365 0 00-.51.063L4.566 9.879a.32.32 0 01-.484.033L1.891 7.769a.366.366 0 00-.515.006l-.423.433a.364.364 0 00.006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 00-.063-.51z";
const TICK_SVG_SINGLE = `<svg viewBox="0 0 12 15" aria-hidden="true"><path fill="currentColor" d="${TICK_PATH}"/></svg>`;
const TICK_SVG_DOUBLE = `<svg viewBox="0 0 17 15" aria-hidden="true"><path fill="currentColor" d="${TICK_PATH}"/><path fill="currentColor" d="${TICK_PATH}" transform="translate(5.075 2.288)"/></svg>`;
// WhatsApp's in-flight clock: outlined circle with hands, sized to sit in the
// same 15-unit-tall box as the ticks (faded via .tick.pending).
const TICK_SVG_CLOCK = `<svg viewBox="0 0 12 15" aria-hidden="true"><circle cx="6" cy="7.5" r="4.55" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 4.9v2.6h2.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- Fade in / fade out ----------
// Toggling .hidden alone can't animate: display:none isn't transitional.
// hideEl() keeps the element rendered under .fade-out (see the CSS block in
// index.html) and swaps in .hidden when the transition is done; showEl()
// reveals it with .fade-out pre-applied, then removes it so the element
// transitions in from transparent. A per-element timer (cleared on the
// opposite call) keeps rapid show/hide/show sequences from fighting each
// other with a stale timeout.
const FADE_MS = 200; // matches the 0.18s CSS transitions, plus a frame

function showEl(el) {
  clearTimeout(el._fadeTimer);
  el.classList.add("fade-out");
  el.classList.remove("hidden");
  void el.offsetWidth; // flush so the transition runs from transparent
  el.classList.remove("fade-out");
}

function hideEl(el) {
  if (el.classList.contains("hidden")) return;
  clearTimeout(el._fadeTimer);
  el.classList.add("fade-out");
  el._fadeTimer = setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("fade-out");
  }, FADE_MS);
}

let currentUser = null;
let profileCache = {}; // id -> display_name (usernames are looked up ad-hoc for search)
let usernameCache = {}; // id -> username (sign-in handle; shown on hover of the chat header name)
let messageCache = {}; // id -> full message row, so replies can show a quote
let messageRowById = {}; // id -> rendered DOM row, so we can scroll to it
let replyingTo = null; // the message object currently being replied to
let lastRenderedSenderId = null;
let lastRenderedDay = null;
let lastRowElement = null;
let unseenWhileScrolledUp = 0;
let typingTimers = {}; // user_id -> timeout handle
let typingChannel = null;
let currentPartner = null; // the other user in the open conversation
let chatSummaries = {}; // partnerId -> { last: message row, unread: count }
let messagesChannel = null; // live INSERT/UPDATE/DELETE subscription for messages
let profilesChannel = null; // live UPDATE/DELETE subscription for profiles
let messagesChannelSince = 0; // when each channel was (re)built, for stuck-join detection
let profilesChannelSince = 0;
let presenceChannel = null; // shared realtime presence channel (green online dots)
let presenceChannelSince = 0;
let onlineUsers = new Set(); // user ids currently connected, from presence sync

// ---------- Theme toggle ----------
const SUN_ICON = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
const MOON_ICON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (themeIcon) themeIcon.innerHTML = theme === "light" ? MOON_ICON : SUN_ICON;
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
    // Custom hover tooltip (styled ::after bubble) mirrors the aria-label,
    // which flips with the current theme
    themeToggle.dataset.tip = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#ECE5DD" : "#0E1116");
  try {
    localStorage.setItem("circle-theme", theme);
  } catch (e) {}
}

applyTheme(document.documentElement.getAttribute("data-theme") || "dark");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(current === "light" ? "dark" : "light");
  });
}

// ---------- Auth mode toggle ----------
function resetAuthFields() {
  authFullname.value = "";
  authName.value = "";
  authPassword.value = "";
  authError.textContent = "";
  authPassword.type = "password";
  passwordToggle.setAttribute("aria-label", "Show password");
  passwordToggle.setAttribute("aria-pressed", "false");
  passwordToggleIcon.innerHTML = `
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  `;
}

authToggle.addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  authSubmit.textContent = isSignUpMode ? "Sign up" : "Sign in";
  authToggle.textContent = isSignUpMode
    ? "Already have an account? Sign in"
    : "Need an account? Sign up";

  // Switching auth modes always starts with a completely fresh form.
  resetAuthFields();

  // Name is only collected (and required) when signing up — the login
  // dialog only ever asks for username + password.
  authFullname.classList.toggle("hidden", !isSignUpMode);
  authFullname.required = isSignUpMode;
});

// Used right after a successful sign-up: lands the person on the login form
// instead of the toggle's usual "wipe everything" reset, so they don't have
// to retype the username they just chose.
function switchToSignInMode({ prefillUsername, message } = {}) {
  isSignUpMode = false;
  authSubmit.textContent = "Sign in";
  authToggle.textContent = "Need an account? Sign up";
  resetAuthFields();
  authFullname.classList.add("hidden");
  authFullname.required = false;
  if (prefillUsername) authName.value = prefillUsername;
  if (message) {
    authError.style.color = "#3A8B5C";
    authError.textContent = message;
  }
}

passwordToggle.addEventListener("click", () => {
  const showing = authPassword.type === "text";
  authPassword.type = showing ? "password" : "text";
  passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  passwordToggle.setAttribute("aria-pressed", String(!showing));
  passwordToggleIcon.innerHTML = showing
    ? `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle>`
    : `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle><path d="M4 4l16 16"></path>`;
});

// Supabase's auth system needs an email-shaped string, but the user only
// ever sees and types a username. We turn it into a fake internal address
// behind the scenes so no real email is ever sent.
function usernameToFakeEmail(username) {
  const clean = username.trim();
  return `${clean}@users.circle-app.local`;
}

function validateName(name) {
  if (!name.trim()) return "Name is required.";
  if (name.length > 20) return "Name must be 20 characters or fewer.";
  return null;
}

// Same rules as the notes website
function validateUsername(username) {
  if (username.length < 5 || username.length > 10) {
    return "Username must be 5–10 characters.";
  }
  if (!/^[a-z0-9_.]+$/.test(username)) {
    return "Username can contain only lowercase letters, numbers, underscores, and dots.";
  }
  return null;
}

function validatePassword(password) {
  if (password.length < 8 || password.length > 20) {
    return "Password must be 8–20 characters.";
  }
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password needs a special character.";
  return null;
}

// ---------- Auth submit ----------
// Set right before signUp() and consumed by onAuthStateChange below: with
// email confirmation off, Supabase signs the new account straight in and
// fires a normal SIGNED_IN event, which would otherwise drop the person
// straight into the app. This flag lets that handler recognize "this
// SIGNED_IN event is the automatic one from a signup" and sign back out
// instead, so new users land on the login screen like everyone else.
let justSignedUp = false;

// The login password, stashed by the auth form and consumed once by
// enterApp → CircleCrypto.setupKeys() to unlock/create this device's
// encryption key. Never persisted — after the first login on a device the
// key itself is cached in localStorage and refreshes need no password.
let pendingPassword = null;

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";

  const fullName = authFullname.value;
  const username = authName.value.trim();
  const password = authPassword.value;

  if (isSignUpMode) {
    const nameError = validateName(fullName);
    if (nameError) {
      authError.style.color = "#C4574B";
      authError.textContent = nameError;
      return;
    }
    const usernameError = validateUsername(username);
    if (usernameError) {
      authError.style.color = "#C4574B";
      authError.textContent = usernameError;
      return;
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      authError.style.color = "#C4574B";
      authError.textContent = passwordError;
      return;
    }
  }

  authSubmit.disabled = true;
  const fakeEmail = usernameToFakeEmail(username);

  try {
    if (isSignUpMode) {
      justSignedUp = true;
      const { error } = await supabaseClient.auth.signUp({
        email: fakeEmail,
        password,
        // display_name drives what shows on message bubbles / typing indicator —
        // that should be the person's name, not their (login-only) username.
        // username is also passed through so the handle_new_user() DB trigger
        // can use it directly instead of having to parse it back out of the
        // fake email address.
        options: { data: { display_name: fullName, username } },
      });
      if (error) throw error;
      // The SIGNED_IN event this triggers is handled by onAuthStateChange,
      // which signs back out and shows the login form — nothing more to do here.
    } else {
      // Set before the call: the SIGNED_IN event (and thus enterApp) can fire
      // before signInWithPassword's promise resolves.
      pendingPassword = password;
      const { error } = await supabaseClient.auth.signInWithPassword({ email: fakeEmail, password });
      if (error) {
        pendingPassword = null;
        throw error;
      }
    }
  } catch (err) {
    justSignedUp = false;
    authError.style.color = "#C4574B";
    authError.textContent = err.message.includes("already registered")
      ? "That username is taken."
      : err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

signOutBtn.addEventListener("click", async () => {
  await unsubscribeFromPush();
  await supabaseClient.auth.signOut();
});

// Stop this browser from receiving push notifications once the user logs out.
// Without this, the push_subscriptions row (and the browser's own subscription)
// stays active forever, so the server keeps sending notifications even though
// nobody's logged in on this device anymore.
//
// Must run BEFORE auth.signOut(): deleting the rows needs the still-valid
// session for the table's row-level security to allow it.
async function unsubscribeFromPush() {
  const userId = currentUser?.id;
  try {
    // Cancel the browser-side subscription when we can find it. This alone
    // isn't relied on: it can come back null (permission revoked, or the
    // service worker hasn't finished registering right after a reload), and
    // any endpoint it misses would keep receiving pushes.
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      if (subscription) await subscription.unsubscribe();
    }

    // Delete every subscription row for this user, not just this device's
    // endpoint — stale rows from earlier logins would otherwise keep the
    // notifications coming. This is what actually stops the server sending.
    if (userId) {
      const { error } = await supabaseClient
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId);
      if (error) console.error(error);
    }
  } catch (err) {
    console.error(err);
  }
}

// ---------- Session handling ----------
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    // With email confirmation off, signUp() above immediately establishes a
    // session and fires this same SIGNED_IN event — intercept that one case
    // and sign back out instead of entering the app, so new accounts land on
    // the login screen instead of being dropped straight into a chat.
    if (justSignedUp) {
      justSignedUp = false;
      const createdUsername = session.user.user_metadata?.username || "";
      supabaseClient.auth.signOut().then(() => {
        switchToSignInMode({
          prefillUsername: createdUsername,
          message: "Account created — sign in to continue.",
        });
      });
      return;
    }
    // Supabase re-fires this event (e.g. TOKEN_REFRESHED) whenever the tab
    // regains focus/visibility, not just on real sign-in. Without this guard,
    // switching back to this tab after opening a media file would re-run the
    // whole enter flow and open duplicate realtime/typing channels on every
    // focus. Only run the full init when this is actually a different/new
    // session.
    if (currentUser?.id === session.user.id) return;
    currentUser = session.user;
    enterApp();
  } else {
    resetToAuthScreen();
  }
});

// Tears everything user-specific down and lands back on the login form.
// Shared by real sign-outs and by "this account was deleted server-side"
// (handleProfileDeleted), which needs the exact same reset.
function resetToAuthScreen() {
  currentUser = null;
  currentPartner = null;
  closeConversation();
  // Leaving also stops broadcasting presence: removing the channel sends the
  // leave, so other users' dots go gray immediately rather than waiting for
  // the socket to time out. Clear the local set too so no dot outlives it.
  if (presenceChannel) {
    supabaseClient.removeChannel(presenceChannel).catch(() => {});
    presenceChannel = null;
  }
  onlineUsers = new Set();
  renderPresence();
  // Sign-out removed this user's push subscription rows, so allow
  // subscribeToPush to run again if they sign back in this session.
  pushSubscribedForUser = null;
  document.documentElement.classList.remove("has-session");
  // Desktop two-pane: drop the signed-in shell so the desktop layout CSS
  // stops force-showing the chats list next to the auth screen.
  document.documentElement.classList.remove("app-visible");
  showEl(authScreen);
  hideEl(chatsScreen);
  hideEl(chatScreen);
  setAppHeight();
}

// ---------- Live profile updates ----------
// Someone renaming themselves in Settings should show up in everyone's open
// tab immediately: update the cache and patch the DOM in place (name labels,
// quoted replies, typing indicator) rather than re-rendering the whole list,
// which would reset scroll position for other viewers.
function buildProfilesChannel() {
  const channel = supabaseClient
    .channel("public:profiles")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles" },
      (payload) => {
        const { id, display_name, username } = payload.new;
        // Cache the username before the display-name early return below so a
        // username-only change still lands (and can't be missed).
        if (id && username) usernameCache[id] = username;
        if (!id || profileCache[id] === display_name) return;
        profileCache[id] = display_name;

        // The row elements know their sender via dataset.msgId -> message,
        // but simpler: walk rows and match the cached message's sender.
        for (const row of messageList.querySelectorAll(".msg-row")) {
          const msg = messageCache[row.dataset.msgId];
          if (!msg) continue;
          if (msg.sender_id === id) {
            const nameEl = row.querySelector(".sender-name");
            if (nameEl) nameEl.textContent = display_name;
          }
          // Quoted names show the *quoted* message's sender ("You" for own
          // quotes), so only patch when the original was written by this user.
          if (msg.reply_to) {
            const original = messageCache[msg.reply_to];
            if (original && original.sender_id === id) {
              const qName = row.querySelector(".quoted-name");
              if (qName && qName.textContent !== "You") qName.textContent = display_name;
            }
          }
        }

        // A rename mid-typing should update the "… is typing" text too
        if (activeTypers[id]) {
          activeTypers[id] = display_name;
          renderTypingIndicator();
        }

        // ...and the conversation header / chats-list rows showing that name
        if (currentPartner === id) {
          chatPartnerName.textContent = display_name;
          updatePartnerNameTitle();
        }
        if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
        if (replyingTo && replyingTo.sender_id === id) {
          replyPreviewName.textContent = display_name;
        }
      }
    )
    // A profiles row vanishing means that account was deleted server-side
    // (admin action in the Supabase dashboard) — react to it live.
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "profiles" },
      (payload) => handleProfileDeleted(payload.old?.id)
    )
    .subscribe();
  return channel;
}

// Someone was deleted from Supabase auth. For everyone else this removes
// their name, chat entries and any open conversation with them on the spot;
// for the deleted account's own tab (its JWT is still valid, so realtime
// still delivers the event) it forces an immediate logout.
async function handleProfileDeleted(id) {
  if (!id || !currentUser) return;

  if (id === currentUser.id) {
    // The push rows can still be removed while the orphaned session's JWT is
    // valid; then sign out — the SIGNED_OUT event runs resetToAuthScreen().
    await unsubscribeFromPush();
    await supabaseClient.auth.signOut();
    // Belt: reset even if no SIGNED_OUT event came back (idempotent if it did).
    if (currentUser) resetToAuthScreen();
    return;
  }

  clearTyping(id);
  delete profileCache[id];
  delete usernameCache[id];
  delete chatSummaries[id];

  if (currentPartner === id) {
    // Standing in a conversation whose other side no longer exists — kick
    // back to the chats list (replaceState so back can't re-enter it).
    try { history.replaceState(null, ""); } catch (e) {}
    goBackToChats();
    return;
  }
  if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
}

async function enterApp() {
  // The flash-prevention "has-session"/"has-open-chat" classes (set in
  // <head>, before this real auth check ran) have CSS overrides that
  // force-show #chats-screen or #chat-screen even while they carry the
  // "hidden" class, specifically so the right screen is visible during that
  // brief pre-JS window on a refresh. Once we're here, real classList
  // toggling takes over for the rest of the session — so drop them,
  // otherwise those overrides keep outranking every future .hidden toggle.
  document.documentElement.classList.remove("has-session");
  document.documentElement.classList.remove("has-open-chat");
  // Desktop two-pane: marks the signed-in shell so the desktop layout CSS
  // (chats list pane + conversation pane) applies — removed again on
  // sign-out so the overrides can't leak onto the auth screen.
  document.documentElement.classList.add("app-visible");
  hideEl(authScreen);
  setAppHeight();

  // Unlock (or first-time create) this device's encryption key before any
  // message can render — the login password is only in hand on an active
  // sign-in; afterwards the key is cached locally and this is instant.
  const keysReady = await CircleCrypto.setupKeys(currentUser.id, pendingPassword);
  pendingPassword = null;
  if (!keysReady) {
    console.warn(
      "Encryption key unavailable — messages will be sent unencrypted and encrypted ones can't be read until you sign out and back in."
    );
  }

  // If a conversation was still open the last time this tab loaded (e.g. the
  // user refreshed the page), reopen it instead of dropping back to the
  // chats list.
  const savedPartner = getStoredOpenChat();
  // Desktop two-pane: when a conversation is about to be reopened, reveal
  // the right pane right away instead of showing the placeholder until
  // openConversation() runs (after profiles load). No-op on mobile.
  if (savedPartner) document.documentElement.classList.add("chat-open");

  loadProfiles().then(() => {
    // ensureRealtime() is idempotent: sign out/back in within this tab, tab
    // refocuses and the periodic sync all reuse healthy channels instead of
    // stacking duplicates (each duplicate would process — and render — every
    // message event multiple times).
    ensureRealtime();
    if (savedPartner) {
      chatsScreen.classList.add("hidden");
      loadChatSummaries();
      // replace=true: the refresh already reused this history entry, so
      // re-opening must not push a duplicate chat entry behind back.
      openConversation(savedPartner, true);
    } else {
      currentPartner = null;
      document.documentElement.classList.remove("chat-open");
      chatScreen.classList.add("hidden");
      chatsScreen.classList.remove("hidden");
      loadChatSummaries();
    }
  });
}

// ---------- Remember which conversation is open, across refreshes ----------
function getStoredOpenChat() {
  try {
    return sessionStorage.getItem("circle-open-chat");
  } catch (e) {
    return null;
  }
}

function setStoredOpenChat(partnerId) {
  try {
    sessionStorage.setItem("circle-open-chat", partnerId);
  } catch (e) {}
}

function clearStoredOpenChat() {
  try {
    sessionStorage.removeItem("circle-open-chat");
  } catch (e) {}
}

// Hover tooltip for the chat header name: reveals the partner's username —
// the sign-in handle used to search for them — alongside their display name.
// Uses the styled data-tip bubble (same system as the header icon buttons);
// the attribute is removed entirely while the username isn't cached, since an
// empty data-tip would still render an empty bubble. Stays in sync wherever
// the header name is rewritten.
function updatePartnerNameTitle() {
  const username = currentPartner ? usernameCache[currentPartner] : null;
  if (username) {
    chatPartnerName.dataset.tip = `@${username}`;
  } else {
    chatPartnerName.removeAttribute("data-tip");
  }
}

// ---------- Conversation navigation ----------
// Each opened conversation gets its own history entry, so the phone's /
// browser's back button walks back out of a chat to the chats list instead
// of leaving the site. `replace` (used when a refresh reopens the saved
// conversation) swaps the state on the current entry rather than stacking
// a duplicate one.
async function openConversation(partnerId, replace = false) {
  currentPartner = partnerId;
  setStoredOpenChat(partnerId);
  try {
    if (replace || history.state?.circleChat) {
      history.replaceState({ circleChat: partnerId }, "");
    } else {
      history.pushState({ circleChat: partnerId }, "");
    }
  } catch (e) {}
  // The screen switch below must happen BEFORE any network awaits — awaiting
  // the partner's profile name first left the user staring at the chats list
  // for a full round trip after tapping a chat. Show "…" and fill the name
  // in when it arrives.
  chatPartnerName.textContent = profileCache[partnerId] || "…";
  updatePartnerNameTitle();
  // Paint the online dot straight from the last presence sync instead of
  // waiting for the next sync event to repaint it.
  renderPresence();
  // Opening the chat reads everything, so its unread badge is stale from
  // here on (markConversationSeen persists this in the database).
  if (chatSummaries[partnerId]) chatSummaries[partnerId].unread = 0;

  hideEl(chatsScreen);
  showEl(chatScreen);
  setAppHeight();
  // Desktop two-pane: reveal the right pane (until now the placeholder was
  // showing) and repaint the still-visible left pane so this conversation's
  // unread badge clears and its row gets the active highlight.
  document.documentElement.classList.add("chat-open");
  renderChatListIfVisible();
  updateActiveChatItem();
  if (!profileCache[partnerId]) {
    ensureProfileCached(partnerId).then((name) => {
      if (name && currentPartner === partnerId) {
        chatPartnerName.textContent = name;
        updatePartnerNameTitle();
      }
    });
  }
  // Clear out the previous conversation's messages immediately, rather than
  // leaving them on screen until loadMessages()'s fetch resolves — otherwise
  // there's a visible flash of stale content right after the screen switches.
  clearMessageList();
  cancelReply();
  hideComposerError();
  userSearch.value = "";
  hideSearchResults();

  await loadMessages();
  subscribeTyping();
  markConversationSeen();
}

function closeConversation() {
  // Detach the typing broadcast for this conversation so signals from it
  // stop arriving while browsing the chats list (or after sign-out).
  if (typingChannel) {
    supabaseClient.removeChannel(typingChannel);
    typingChannel = null;
  }
  Object.keys(activeTypers).forEach(clearTyping);
  hideEl(chatScreen);
  currentPartner = null;
  // No conversation open means the header dot has no partner to show.
  renderPresence();
  clearStoredOpenChat();
  // Desktop two-pane: the conversation pane fades out in its own spot (the
  // desktop CSS keeps fading screens in flow), so .chat-open must stay until
  // that fade finishes — removing it now would display:none the pane and cut
  // the fade to a hard cut. After the fade, hand the space to the placeholder
  // and fade IT in the same way. Reopening a conversation in the meantime
  // cancels the swap (the guard below sees a partner again).
  if (isDesktopLayout()) {
    clearTimeout(desktopChatCloseTimer);
    desktopChatCloseTimer = setTimeout(() => {
      if (currentPartner) return;
      document.documentElement.classList.remove("chat-open");
      showEl(chatPlaceholder);
    }, FADE_MS);
  } else {
    document.documentElement.classList.remove("chat-open");
  }
  updateActiveChatItem();
}

// Pending desktop hand-off from conversation pane back to the placeholder.
let desktopChatCloseTimer = null;

async function goBackToChats() {
  closeConversation();
  showEl(chatsScreen);
  setAppHeight();
  // Paint immediately from the summaries we already hold (kept up to date by
  // the realtime handlers and optimistic sends) instead of blocking on a
  // network fetch — then re-sync in the background in case anything was
  // missed, which just quietly re-renders the same list.
  renderChatList();
  loadChatSummaries();
}

// In-app back arrow: unwind the history entry so the phone's back button and
// this arrow stay in sync (both end up on the chats-list entry).
backButton.addEventListener("click", () => {
  if (history.state?.circleChat && history.length > 1) {
    history.back(); // the popstate handler below does the actual switch
  } else {
    // Hard-loaded straight into a chat with nothing to unwind: close
    // manually and clear the state so the phone's back button can't
    // re-enter a stale conversation afterwards.
    try { history.replaceState(null, ""); } catch (e) {}
    goBackToChats();
  }
});

// Phone/browser back or forward: mirror the UI to whatever entry we landed on.
window.addEventListener("popstate", (e) => {
  if (currentPartner && !e.state?.circleChat) {
    goBackToChats();
  } else if (!currentPartner && e.state?.circleChat) {
    openConversation(e.state.circleChat, true);
  }
});

// ---------- Header name: tap must not select, hold must ----------
// On mobile, a tap on the partner's name whose finger drifts a few pixels (or
// a quick double-tap) makes the browser run its text-selection drag and leave
// a blue ::selection box over the name. Selection there should only ever come
// from a deliberate hold, so when the touch that just ended was short,
// collapse whatever selection it produced. Touches that lasted past the
// long-press threshold are left alone, so hold-to-select keeps working.
const HOLD_SELECT_MS = 400; // Android/iOS select on holds of roughly 500ms
let nameTouchStartedAt = 0;
chatPartnerName.addEventListener("touchstart", () => {
  nameTouchStartedAt = Date.now();
}, { passive: true });
chatPartnerName.addEventListener("touchend", () => {
  if (Date.now() - nameTouchStartedAt >= HOLD_SELECT_MS) return;
  // The highlight is painted at touch-up, after this handler runs, so
  // collapsing synchronously could miss it — wait a beat instead.
  setTimeout(() => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }, 50);
}, { passive: true });

// ---------- Profiles ----------
async function loadProfiles() {
  const { data, error } = await supabaseClient.from("profiles").select("id, display_name, username, public_key");
  if (error) return console.error(error);
  profileCache = Object.fromEntries(data.map((p) => [p.id, p.display_name]));
  usernameCache = Object.fromEntries(data.filter((p) => p.username).map((p) => [p.id, p.username]));
  data.forEach((p) => CircleCrypto.cachePublicKey(p.id, p.public_key));
}

// ---------- Chats list ----------
// Builds the conversation list from the most recent messages: group by
// partner (whoever of sender/recipient isn't me), keep each partner's latest
// message as the row preview, and count messages I received but haven't seen.
async function loadChatSummaries() {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("id, sender_id, recipient_id, body, media_path, created_at, seen_at")
    .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return console.error(error);

  chatSummaries = {};
  for (const msg of data) {
    const partner = msg.sender_id === currentUser.id ? msg.recipient_id : msg.sender_id;
    const s = (chatSummaries[partner] ||= { last: null, unread: 0 });
    if (!s.last) s.last = msg;
    if (msg.recipient_id === currentUser.id && !msg.seen_at) s.unread++;
  }
  // Last messages of conversations can be encrypted — resolve each preview
  // (instant no-op for legacy plaintext rows) before painting the list.
  await Promise.all(Object.values(chatSummaries).map(setSummaryPreview));
  renderChatList();
}

// Resolves a conversation's chats-list preview text from its last message
// (decrypting it when needed) into s.preview.
async function setSummaryPreview(s) {
  if (!s.last) return;
  try {
    const view = await CircleCrypto.decryptRow(s.last);
    s.preview = previewText(view);
  } catch (e) {
    s.preview = "";
  }
}

function previewText(msg) {
  if (msg.media_path) return "📷 Photo";
  return msg.body || "";
}

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  // hour12 forces AM/PM everywhere — a bare toLocaleTimeString follows the
  // device's locale/clock setting, which renders 24-hour on many phones.
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Rebuilding the list resets its scroll position and tap/hover states, so
// skip the work when nothing visible changed — the periodic background
// re-sync runs this often on a healthy client, where it's a pure no-op.
let lastChatListSignature = null;

// ---------- Desktop two-pane helpers ----------
// The desktop layout (min-width: 768px in index.html) keeps the chats list
// visible in a left pane even while a conversation is open — the list pane
// still carries the mobile flow's "hidden" class underneath, so visibility
// checks and repaints must account for it.
function isDesktopLayout() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function renderChatListIfVisible() {
  if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
}

// Highlights the row of the conversation currently open in the desktop right
// pane (a no-op for row state on mobile, where no list is visible in a chat).
function updateActiveChatItem() {
  chatList.querySelectorAll(".chat-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.partner === currentPartner);
  });
}

function renderChatList() {
  const partners = Object.keys(chatSummaries).sort(
    (a, b) => new Date(chatSummaries[b].last.created_at) - new Date(chatSummaries[a].last.created_at)
  );
  const signature = partners
    .map(
      (p) =>
        `${p}:${chatSummaries[p].last?.id}:${chatSummaries[p].unread}:${profileCache[p] ?? ""}:${chatSummaries[p].preview ?? ""}:${onlineUsers.has(p) ? 1 : 0}`
    )
    .join("|");
  if (signature === lastChatListSignature) return;
  lastChatListSignature = signature;

  chatList.innerHTML = "";

  if (partners.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = "No chats yet — search for a username above to start one.";
    chatList.appendChild(empty);
    return;
  }

  for (const partner of partners) {
    const s = chatSummaries[partner];
    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.partner = partner;
    if (partner === currentPartner) item.classList.add("active");
    item.setAttribute("role", "button");
    item.tabIndex = 0;

    const info = document.createElement("div");
    info.className = "chat-item-info";

    const top = document.createElement("div");
    top.className = "chat-item-top";
    const name = document.createElement("span");
    name.className = "chat-item-name";
    name.textContent = profileCache[partner] || "Someone";
    const time = document.createElement("span");
    time.className = "chat-item-time";
    time.textContent = timeLabel(s.last.created_at);
    // The online dot only shows in the open chat's header now — chats-list
    // rows no longer append one here.
    const right = document.createElement("span");
    right.className = "chat-item-right";
    right.appendChild(time);
    top.appendChild(name);
    top.appendChild(right);

    const bottom = document.createElement("div");
    bottom.className = "chat-item-bottom";
    const preview = document.createElement("span");
    preview.className = "chat-item-preview";
    // When the last message in a conversation is mine, show its delivery
    // tick ahead of the text — same vocabulary as in the chat itself — so the
    // preview is readable as "I sent this" without any extra label.
    if (s.last.sender_id === currentUser.id) {
      const tick = document.createElement("span");
      tick.className = "tick" + (s.last.seen_at ? " seen" : "");
      tick.innerHTML = s.last.seen_at ? TICK_SVG_DOUBLE : TICK_SVG_SINGLE;
      preview.appendChild(tick);
    }
    preview.appendChild(document.createTextNode(s.preview != null ? s.preview : previewText(s.last)));
    bottom.appendChild(preview);
    if (s.unread > 0) {
      const badge = document.createElement("span");
      badge.className = "chat-item-badge";
      badge.textContent = s.unread;
      bottom.appendChild(badge);
    }

    info.appendChild(top);
    info.appendChild(bottom);
    item.appendChild(info);
    item.addEventListener("click", () => openConversation(partner));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openConversation(partner);
      }
    });
    chatList.appendChild(item);
  }
}

// A new/updated message arrived while we're not inside that conversation:
// refresh the affected row's preview and unread badge.
function updateChatSummaryFor(msg) {
  const partner = msg.sender_id === currentUser.id ? msg.recipient_id : msg.sender_id;
  const s = (chatSummaries[partner] ||= { last: null, unread: 0 });
  if (!s.last || new Date(msg.created_at) >= new Date(s.last.created_at)) {
    s.last = msg;
    // Blank placeholder while the preview decrypts (near-instant for
    // plaintext); setSummaryPreview re-renders with the real text.
    s.preview = "";
    setSummaryPreview(s).then(() => {
      if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
    });
  }
  if (msg.recipient_id === currentUser.id && !msg.seen_at && currentPartner !== partner) s.unread++;
  // A brand-new contact's first message would otherwise sit as "Someone"
  // until the next full reload — pull the name and repaint the row with it.
  if (!profileCache[partner]) {
    ensureProfileCached(partner).then(() => {
      if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
    });
  }
  if (!chatsScreen.classList.contains("hidden") || isDesktopLayout()) renderChatList();
}

// ---------- User search ----------
let searchDebounce = null;

// Usernames are 5–10 characters (see validateUsername). Only search once a
// full username could actually have been typed — partial/mid-typing input
// shouldn't surface suggestions.
const USERNAME_MIN_LENGTH = 5;

userSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  const term = userSearch.value.trim().toLowerCase();
  if (term.length < USERNAME_MIN_LENGTH) {
    hideSearchResults();
    return;
  }
  searchDebounce = setTimeout(() => runUserSearch(term), 250);
});

async function runUserSearch(term) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, display_name, username, public_key")
    .eq("username", term)
    .neq("id", currentUser.id)
    .limit(10);
  if (error) return console.error(error);

  searchResults.innerHTML = "";
  if (data.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = `No user "@${term}" found.`;
    searchResults.appendChild(empty);
  } else {
    for (const p of data) {
      profileCache[p.id] = p.display_name;
      if (p.username) usernameCache[p.id] = p.username;
      CircleCrypto.cachePublicKey(p.id, p.public_key);
      const row = document.createElement("div");
      row.className = "search-result";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const name = document.createElement("span");
      name.className = "search-result-name";
      name.textContent = p.display_name;
      const username = document.createElement("span");
      username.className = "search-result-username";
      username.textContent = p.username;
      row.appendChild(name);
      row.appendChild(username);
      row.addEventListener("click", () => openConversation(p.id));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openConversation(p.id);
        }
      });
      searchResults.appendChild(row);
    }
  }
  showEl(searchResults);
}

function hideSearchResults() {
  // Content is dropped once the fade-out finishes, not immediately —
  // clearing now would collapse the box mid-animation.
  clearTimeout(searchResults._fadeTimer);
  hideEl(searchResults);
  searchResults._fadeTimer = setTimeout(() => { searchResults.innerHTML = ""; }, FADE_MS);
}

// Dismiss search results when tapping elsewhere on the chats screen
chatsScreen.addEventListener("click", (e) => {
  if (!e.target.closest(".search-bar")) hideSearchResults();
});

// ---------- Load message history (current conversation) ----------
async function loadMessages(includeMessageId = null) {
  // Order newest-first so limit(200) keeps the most recent 200 messages,
  // then reverse back to oldest-first for rendering. Ordering ascending
  // before the limit (the old behavior) kept the OLDEST 200 messages in any
  // conversation past that size, silently dropping every recent message and
  // leaving the view scrolled to the bottom of a stale batch.
  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${currentPartner}),and(sender_id.eq.${currentPartner},recipient_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return console.error(error);

  const messages = data || [];

  // A reply can point to a message older than the newest 200. When the user
  // taps that quote, fetch the exact target and include it in this render so
  // there is a real DOM row for scrollToMessage() to jump to. The conversation
  // check below is deliberate: the id comes from a reply_to field, so never
  // render a row from some unrelated conversation even if an id is supplied.
  if (includeMessageId && !messages.some((msg) => msg.id === includeMessageId)) {
    const { data: target, error: targetError } = await supabaseClient
      .from("messages")
      .select("*")
      .eq("id", includeMessageId)
      .maybeSingle();

    const targetBelongsToConversation = target &&
      ((target.sender_id === currentUser.id && target.recipient_id === currentPartner) ||
       (target.sender_id === currentPartner && target.recipient_id === currentUser.id));

    if (!targetError && targetBelongsToConversation) {
      messages.push(target);
    } else if (targetError) {
      console.error(targetError);
    }
  }

  // The targeted message may be much older than the normal history window, so
  // sort after adding it to keep the chronological message order intact.
  messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  await renderAllMessages(messages);

  // Always open the conversation at the newest message. scrollTop is set
  // directly (no smooth scroll), so the latest message is simply what's on
  // screen from the first paint.
  // Skipped on the scrollToMessage() path (includeMessageId set): that call
  // only re-renders to materialize the target row, and these bottom-anchors
  // would fire mid-flight and yank the user back down before the scroll to
  // the target finishes.
  if (!includeMessageId) {
    scrollToBottom();
    // Images and content-visibility placeholders resolving a few frames later
    // can change the scroll height and nudge the viewport off the bottom;
    // re-assert it briefly. isNearBottom() guards this so a user who scrolled
    // up immediately is never dragged back down.
    requestAnimationFrame(() => { if (isNearBottom()) scrollToBottom(); });
    setTimeout(() => { if (isNearBottom()) scrollToBottom(); }, 100);
    setTimeout(() => { if (isNearBottom()) scrollToBottom(); }, 300);
  }
  updateJumpBottom();
}

async function renderAllMessages(data) {
  // Decrypt every row first (no-op for legacy plaintext rows) so rows render
  // in order with plaintext bodies, and messageCache holds decrypted views
  // for later quotes. Encrypted photos start downloading/decrypting inside
  // renderMessage; the row itself is placed synchronously here.
  const views = await Promise.all(data.map((row) => CircleCrypto.decryptRow(row)));
  // Batch render of existing history: no per-row entry animation (see the
  // .animate-in rule in index.html) — otherwise the whole list visibly
  // flickers up whenever it re-renders after a refresh.
  suppressEntryAnimation = true;
  clearMessageList();
  views.forEach(renderMessage);
  suppressEntryAnimation = false;
}

let suppressEntryAnimation = false;

function clearMessageList() {
  messageList.innerHTML = "";
  // #jump-bottom lives outside this list now (see index.html), so wiping
  // the messages can't destroy it.
  lastRenderedSenderId = null;
  lastRenderedDay = null;
  lastRowElement = null;
  messageRowById = {}; // old rows are gone, forget where they were
}

// ---------- Settings (display name) ----------
// The name here is the same one collected at signup, which lives in two
// places: profiles.display_name (drives the labels) and the auth account's
// user_metadata.display_name (stored with the login itself). Keep both in
// sync so they can never disagree.
function openSettings() {
  settingsName.value =
    profileCache[currentUser?.id] ||
    currentUser?.user_metadata?.display_name ||
    "";
  settingsError.textContent = "";
  showEl(settingsOverlay);
  settingsName.focus();
}

function closeSettings() {
  hideEl(settingsOverlay);
}

settingsButtons.forEach((button) => {
  if (button) button.addEventListener("click", openSettings);
});
settingsCancel.addEventListener("click", closeSettings);

// Click on the dark backdrop (outside the card) closes the modal too.
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettings();
});
settingsName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    settingsSave.click();
  }
});

settingsSave.addEventListener("click", async () => {
  const name = settingsName.value;
  const nameError = validateName(name);
  if (nameError) {
    settingsError.textContent = nameError;
    return;
  }
  settingsError.textContent = "";
  settingsSave.disabled = true;

  try {
    // Plain update, not upsert: the profiles row already exists (created by
    // the signup trigger), and the table's RLS only grants users UPDATE on
    // their own row. An upsert also checks the INSERT policy, which isn't
    // granted, so it fails with "new row violates row-level security policy".
    const { data, error } = await supabaseClient
      .from("profiles")
      .update({ display_name: name })
      .eq("id", currentUser.id)
      .select();
    if (error) throw error;
    // An update that matches no row reports no error, so check we got one
    // back — otherwise the UI would show a name the database never saved.
    if (!data || data.length === 0) {
      throw new Error("Couldn't save your name. Try signing out and back in.");
    }

    // Also update the name on the auth account itself, so it matches what was
    // entered at signup and survives independently of the profiles row.
    const { error: metaError } = await supabaseClient.auth.updateUser({
      data: { display_name: name },
    });
    if (metaError) throw metaError;
    // onAuthStateChange ignores this user's own USER_UPDATED event (it would
    // otherwise re-run enterChat), so refresh the in-memory copy here.
    if (currentUser.user_metadata) currentUser.user_metadata.display_name = name;

    profileCache[currentUser.id] = name;
    closeSettings();
    // Re-render so the new name shows above this user's already-sent
    // messages (and in quotes/typing), keeping the current scroll position.
    await refreshMessageNames();
  } catch (err) {
    settingsError.textContent = err.message;
  } finally {
    settingsSave.disabled = false;
  }
});

async function refreshMessageNames() {
  // Called after a self-rename, which can happen from the chats list too —
  // no conversation open means nothing to re-render there.
  if (!currentPartner) {
    renderChatList();
    return;
  }
  // Same filtered query as loadMessages: re-rendering must only ever draw
  // the open conversation, not rows from the user's other chats.
  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${currentPartner}),and(sender_id.eq.${currentPartner},recipient_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return console.error(error);
  const scrollTop = messageList.scrollTop;
  await renderAllMessages(data.reverse());
  messageList.scrollTop = Math.min(scrollTop, messageList.scrollHeight);
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// Scrolls to and briefly highlights a message. A reply can target a message
// outside the normal 200-message history window, so load that exact message
// first when no rendered row exists yet.
async function scrollToMessage(id, behavior = "smooth") {
  let row = messageRowById[id];

  if (!row) {
    await loadMessages(id);
    row = messageRowById[id];
  }

  // The target may have been deleted or may no longer be visible to this user
  // under RLS. In that case the quote simply does nothing instead of throwing.
  if (!row) return false;

  // scrollIntoView() can choose a different scroll container when nested
  // layout changes (especially on mobile). Keep the jump explicitly inside the
  // message list so the chat itself, not the page, is what moves.
  const listRect = messageList.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const targetTop = messageList.scrollTop +
    (rowRect.top - listRect.top) -
    (messageList.clientHeight - rowRect.height) / 2;
  const maxScrollTop = Math.max(0, messageList.scrollHeight - messageList.clientHeight);
  messageList.scrollTo({
    top: Math.max(0, Math.min(targetTop, maxScrollTop)),
    behavior,
  });

  row.classList.remove("highlight-flash");
  void row.offsetWidth;
  row.classList.add("highlight-flash");
  setTimeout(() => row.classList.remove("highlight-flash"), 1200);
  return true;
}

// ---------- Realtime subscription ----------

// If a message comes in from a sender we don't have cached (e.g. they
// signed up after we already loaded the profile list), fetch just that
// one profile instead of showing "Someone" forever.
async function ensureProfileCached(id) {
  if (profileCache[id]) return profileCache[id];
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, display_name, username, public_key")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  profileCache[id] = data.display_name;
  if (data.username) usernameCache[id] = data.username;
  CircleCrypto.cachePublicKey(id, data.public_key);
  return data.display_name;
}

function buildMessagesChannel() {
  const channel = supabaseClient
    .channel("public:messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        const msg = payload.new;
        // RLS means we only ever see rows we're sender or recipient of.
        if (msg.sender_id !== currentUser.id && msg.recipient_id !== currentUser.id) return;
        // Encrypted rows are decrypted into a "view" before anything renders
        // or is cached (legacy plaintext rows pass through untouched).
        handleIncomingMessage(await CircleCrypto.decryptRow(msg));
      }
    )
    // Read receipts: the recipient marking my messages seen flips my
    // single tick to a double tick in place.
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        if (!msg.seen_at || payload.old.seen_at) return;
        const row = messageRowById[msg.id];
        if (row) {
          const tick = row.querySelector(".tick");
          if (tick) {
            tick.innerHTML = TICK_SVG_DOUBLE;
            tick.classList.add("seen");
          }
        }
        if (msg.sender_id === currentUser.id) updateChatSummaryFor(msg);
      }
    )
    // Rows deleted server-side (the admin deleted the other participant and
    // a DB trigger wiped the whole conversation): drop them from the open
    // chat in place and refresh any chat-list preview that pointed at one.
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages" },
      (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        const row = messageRowById[id];
        if (row) {
          if (lastRowElement === row) lastRowElement = null;
          row.remove();
        }
        delete messageRowById[id];
        delete messageCache[id];
        for (const partner of Object.keys(chatSummaries)) {
          if (chatSummaries[partner].last && chatSummaries[partner].last.id === id) {
            resyncChatSummariesSoon();
            break;
          }
        }
      }
    )
    .subscribe();
  return channel;
}

// Keeps both live channels up. A websocket that silently died while the tab
// was suspended (phones especially) sits in an errored/closed state forever
// otherwise — push notifications keep arriving over their separate server
// path, but the UI would stay stale until a manual refresh. A healthy
// "joined" channel is left untouched; sign out/in within the tab reuses it
// (supabase-js feeds the current token to the socket on every auth change).
function channelIsDead(channel, since) {
  if (!channel) return false;
  if (channel.state === "errored" || channel.state === "closed") return true;
  // Stuck mid-join for 10s+ (join timeout is 10s) counts as dead too, or a
  // channel that never completes its handshake would never be rebuilt.
  return channel.state !== "joined" && Date.now() - since > 10000;
}

function ensureRealtime() {
  if (channelIsDead(messagesChannel, messagesChannelSince)) {
    supabaseClient.removeChannel(messagesChannel).catch(() => {});
    messagesChannel = null;
  }
  if (channelIsDead(profilesChannel, profilesChannelSince)) {
    supabaseClient.removeChannel(profilesChannel).catch(() => {});
    profilesChannel = null;
  }
  if (channelIsDead(presenceChannel, presenceChannelSince)) {
    supabaseClient.removeChannel(presenceChannel).catch(() => {});
    presenceChannel = null;
  }
  if (!messagesChannel) {
    messagesChannel = buildMessagesChannel();
    messagesChannelSince = Date.now();
  }
  if (!profilesChannel) {
    profilesChannel = buildProfilesChannel();
    profilesChannelSince = Date.now();
  }
  if (!presenceChannel) {
    presenceChannel = buildPresenceChannel();
    presenceChannelSince = Date.now();
  }
}

// ---------- Presence (green online dot) ----------
// Supabase Realtime presence on one shared channel: every signed-in client
// tracks itself (keyed by user id), and each client's presence sync reports
// exactly who else is currently connected. No database writes or schema
// changes — and when a client's socket drops (tab closed, phone suspended),
// Realtime removes it from the sync automatically, so "online" always means
// "the app is actually connected right now", not "was seen recently".
// Multiple tabs/devices of the same user collapse onto one key (Phoenix
// presence stores an array of metas per key), and the dot stays lit until
// the last one disconnects.
function buildPresenceChannel() {
  const channel = supabaseClient.channel("circle-presence", {
    config: { presence: { key: currentUser.id } },
  });
  channel
    .on("presence", { event: "sync" }, () => {
      onlineUsers = new Set(Object.keys(channel.presenceState()));
      renderPresence();
    })
    .subscribe((status) => {
      // Announce this client only once the subscription is actually live;
      // tracking earlier would silently do nothing.
      if (status === "SUBSCRIBED") channel.track({ online_at: new Date().toISOString() });
    });
  return channel;
}

// Repaints everything presence affects: the open conversation's header dot
// and the chats list (whose render signature includes online state, so a
// change actually repaints).
function renderPresence() {
  if (partnerPresence) {
    partnerPresence.classList.toggle("hidden", !(currentPartner && onlineUsers.has(currentPartner)));
  }
  renderChatListIfVisible();
}

// Mobile has no hover, so the dot's "Online" tooltip needs a touch path:
// holding the dot for ~450ms adds .tip-on (showing the ::after bubble), and
// the tooltip lingers briefly after the finger lifts so it can be read. If
// the dot sits inside a tappable row (chats list), the hold must not then
// fire the row's tap handler — hence the suppressed click.
function attachTipHold(el) {
  let timer = null;
  let shown = false;
  el.addEventListener("touchstart", () => {
    clearTimeout(timer);
    shown = false;
    timer = setTimeout(() => {
      el.classList.add("tip-on");
      shown = true;
    }, 450);
  }, { passive: true });
  // Any finger movement means scrolling, not a deliberate hold.
  el.addEventListener("touchmove", () => clearTimeout(timer), { passive: true });
  el.addEventListener("touchcancel", () => clearTimeout(timer));
  el.addEventListener("touchend", () => {
    clearTimeout(timer);
    if (shown) {
      el._suppressClick = true;
      setTimeout(() => {
        el.classList.remove("tip-on");
        el._suppressClick = false;
      }, 900);
    }
  });
  el.addEventListener("click", (e) => {
    if (el._suppressClick) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

// A standalone dot element for chats-list rows (the header's dot is static
// markup in index.html).
function makePresenceDot() {
  const dot = document.createElement("span");
  dot.className = "presence-dot";
  dot.dataset.tip = "Online";
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", "Online");
  attachTipHold(dot);
  return dot;
}

attachTipHold(partnerPresence);

// Coalesces bursts of message DELETEs (a whole conversation wiped at once)
// into a single summaries refresh.
let summaryResyncTimer = null;

function resyncChatSummariesSoon() {
  clearTimeout(summaryResyncTimer);
  summaryResyncTimer = setTimeout(loadChatSummaries, 150);
}

function handleIncomingMessage(msg) {
  const mine = msg.sender_id === currentUser.id;
  const isOpenConversation = currentPartner !== null &&
    (mine ? msg.recipient_id === currentPartner : msg.sender_id === currentPartner);

  // Own messages are already shown the instant they're sent (see the
  // composer's optimistic render below) — when Realtime's echo of that same
  // insert arrives a moment later, skip re-rendering it so it doesn't show
  // up twice.
  if (isOpenConversation && !messageRowById[msg.id]) {
    if (!profileCache[msg.sender_id]) ensureProfileCached(msg.sender_id);
    const wasNearBottom = isNearBottom();
    renderMessage(msg);
    if (wasNearBottom || mine) {
      scrollToBottom();
    } else {
      unseenWhileScrolledUp++;
      updateJumpBottom();
    }
    // The message arrived in the open chat — mark it seen right away, but
    // only if the tab is actually visible: a backgrounded tab doesn't "see"
    // anything (and its push notification shouldn't be contradicted by an
    // instant double tick for the sender).
    if (!mine && document.visibilityState === "visible") markConversationSeen();
    // Someone's message arrived, so they're done typing
    clearTyping(msg.sender_id);
  }

  updateChatSummaryFor(msg);
}

// ---------- Read receipts ----------
// Marks everything my partner sent me in this conversation as seen. Called
// when opening a chat and whenever a new message arrives while it's open.
async function markConversationSeen() {
  if (!currentPartner || !currentUser) return;
  const { error } = await supabaseClient
    .from("messages")
    .update({ seen_at: new Date().toISOString() })
    .eq("recipient_id", currentUser.id)
    .eq("sender_id", currentPartner)
    .is("seen_at", null);
  if (error) console.error(error);
}

// ---------- Typing indicator (Realtime broadcast, no DB writes) ----------
// One broadcast channel per user pair, so typing signals stay within that
// conversation and don't leak into other chats.
function pairChannelName(a, b) {
  return `typing:${[a, b].sort().join(":")}`;
}

function subscribeTyping() {
  // Re-entering the same conversation shouldn't stack duplicate channels.
  if (typingChannel) supabaseClient.removeChannel(typingChannel);

  typingChannel = supabaseClient.channel(pairChannelName(currentUser.id, currentPartner), {
    config: { broadcast: { self: false } },
  });

  typingChannel
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (payload.user_id === currentUser?.id) return;
      showTyping(payload.user_id, payload.name);
    })
    .subscribe();

  // Assign (not addEventListener) so switching conversations replaces the
  // old handler instead of stacking a new one per opened chat — and the
  // handler below no-ops if its channel has since been closed.
  let lastTypingSent = 0;
  messageInput.oninput = () => {
    if (!typingChannel || !messageInput.value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSent < 2000) return;
    lastTypingSent = now;
    typingChannel.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: currentUser.id, name: profileCache[currentUser.id] || "Someone" },
    });
  };
}

const activeTypers = {}; // user_id -> name

function showTyping(userId, name) {
  activeTypers[userId] = name;
  clearTimeout(typingTimers[userId]);
  typingTimers[userId] = setTimeout(() => clearTyping(userId), 3000);
  renderTypingIndicator();
}

function clearTyping(userId) {
  delete activeTypers[userId];
  clearTimeout(typingTimers[userId]);
  renderTypingIndicator();
}

function renderTypingIndicator() {
  const names = Object.values(activeTypers);
  if (names.length === 0) {
    hideEl(typingIndicator);
    return;
  }
  const text =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing…`
      : `${names.length} people are typing…`;
  typingIndicator.textContent = text;
  showEl(typingIndicator);
}

// ---------- Day dividers ----------
function dayLabel(date) {
  const now = new Date();
  const d = new Date(date);
  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

// ---------- Render a message bubble ----------
function renderMessage(msg) {
  const mine = msg.sender_id === currentUser?.id;
  const msgDay = new Date(msg.created_at).toDateString();

  messageCache[msg.id] = msg; // so any later reply to this message can quote it

  if (msgDay !== lastRenderedDay) {
    const divider = document.createElement("div");
    divider.className = "day-divider";
    divider.textContent = dayLabel(msg.created_at);
    messageList.appendChild(divider);
    lastRenderedDay = msgDay;
    lastRenderedSenderId = null; // force a fresh group after a day divider
  }

  const isGrouped = lastRenderedSenderId === msg.sender_id;

  // The previous row (if same sender) is no longer the last in its group
  if (isGrouped && lastRowElement) {
    lastRowElement.classList.remove("group-last");
  }

  const row = document.createElement("div");
  row.className = `msg-row ${mine ? "mine" : "theirs"} group-last ${isGrouped ? "grouped" : "group-start"}`;
  if (!suppressEntryAnimation) row.classList.add("animate-in");
  row.dataset.msgId = msg.id;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Name only on the first bubble of a consecutive run from the same sender —
  // grouping makes it obvious the following ones are from the same person.
  if (!mine && !isGrouped) {
    const nameEl = document.createElement("span");
    nameEl.className = "sender-name";
    nameEl.textContent = profileCache[msg.sender_id] || "Someone";
    bubble.appendChild(nameEl);
  }

  // Quoted preview when this message is a reply to an earlier one
  if (msg.reply_to) {
    const quoted = document.createElement("div");
    quoted.className = "quoted-msg";
    const original = messageCache[msg.reply_to];
    if (original) {
      const qName = document.createElement("span");
      qName.className = "quoted-name";
      qName.textContent = original.sender_id === currentUser?.id ? "You" : profileCache[original.sender_id] || "Someone";
      const qBody = document.createElement("span");
      qBody.className = "quoted-body";
      qBody.textContent = original.body ? truncate(original.body, 80) : original.media_path ? "📷 Photo" : "";
      quoted.appendChild(qName);
      quoted.appendChild(qBody);
    } else {
      quoted.textContent = "Original message";
    }
    quoted.addEventListener("click", async () => {
      quoted.style.pointerEvents = "none";
      try {
        await scrollToMessage(msg.reply_to);
      } finally {
        quoted.style.pointerEvents = "";
      }
    });
    bubble.appendChild(quoted);
  }

  if (msg.media_path) {
    const mediaUrl = supabaseClient.storage.from("chat-media").getPublicUrl(msg.media_path).data.publicUrl;
    if ((msg.media_type || "").startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "media";
      img.alt = "Photo";
      // The initial auto-scroll only has a short fixed window to correct for
      // layout shifts (see loadMessages). A photo that finishes loading after
      // that window has closed grows the list and permanently leaves the
      // viewport stuck above the real bottom — this event-driven correction
      // has no time limit, so it always catches up, however slow the load.
      img.addEventListener("load", () => { if (isNearBottom()) scrollToBottom(); });
      img.addEventListener("error", () => { if (isNearBottom()) scrollToBottom(); });
      // Encrypted photos: fetch + decrypt asynchronously, then fill in src
      // (the URL on its own is just ciphertext). The click opens the
      // decrypted blob when we have one, the ciphertext file otherwise.
      if (msg._mk) {
        CircleCrypto.decryptMedia(msg.media_path, msg._mk, msg._mi, msg.media_type).then((url) => {
          if (url) {
            img.src = url;
            msg._blobUrl = url;
          } else {
            img.alt = "Photo unavailable";
          }
        });
      } else {
        img.src = mediaUrl;
      }
      img.addEventListener("click", () => {
        window.open(msg._blobUrl || mediaUrl, "_blank", "noopener,noreferrer");
      });
      bubble.appendChild(img);
    } else {
      // Attachments that aren't images (e.g. from older clients or direct API
      // inserts) would render as a broken <img> — show a tappable file chip
      // linking to the stored file instead.
      const link = document.createElement("a");
      link.className = "media-file";
      link.href = mediaUrl;
      link.target = "_blank";
      link.rel = "noopener,noreferrer";
      link.textContent = "📎 Attachment";
      if (msg._mk) {
        link.textContent = "🔒 Attachment";
        CircleCrypto.decryptMedia(msg.media_path, msg._mk, msg._mi, msg.media_type).then((url) => {
          if (url) {
            link.href = url;
            msg._blobUrl = url;
          }
        });
      }
      bubble.appendChild(link);
    }
  }

  if (msg.body) {
    const bodyEl = document.createElement("span");
    bodyEl.textContent = msg.body;
    bubble.appendChild(bodyEl);
  }

  const meta = document.createElement("span");
  meta.className = "meta";
  const timeText = document.createElement("span");
  timeText.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  meta.appendChild(timeText);
  if (mine) {
    const tick = document.createElement("span");
    tick.className = "tick";
    // Faded clock while the send is still in flight (optimistic bubble),
    // single tick once actually confirmed sent, double (accent blue) once
    // the recipient saw it.
    if (msg._pending) {
      tick.innerHTML = TICK_SVG_CLOCK;
      tick.classList.add("pending");
    } else if (msg.seen_at) {
      tick.innerHTML = TICK_SVG_DOUBLE;
      tick.classList.add("seen");
    } else {
      tick.innerHTML = TICK_SVG_SINGLE;
    }
    meta.appendChild(tick);
  }
  bubble.appendChild(meta);

  const replyBtn = document.createElement("button");
  replyBtn.type = "button";
  replyBtn.className = "reply-trigger";
  replyBtn.setAttribute("aria-label", "Reply to this message");
  replyBtn.textContent = "↩";
  replyBtn.addEventListener("click", () => {
    // Restart the animation even on rapid re-clicks: removing the class,
    // forcing reflow, then re-adding it makes the browser treat it as a
    // fresh animation instead of a no-op (class already present).
    row.classList.remove("reply-bounce");
    void row.offsetWidth;
    row.classList.add("reply-bounce");
    startReply(msg);
  });
  row.addEventListener("animationend", (e) => {
    if (e.animationName === "reply-bounce") row.classList.remove("reply-bounce");
  });

  // Icon always follows the bubble so a left-swipe drags the bubble away
  // from it, not over it — avoids overlap on both mine and theirs rows.
  row.appendChild(bubble);
  row.appendChild(replyBtn);
  messageList.appendChild(row);
  attachSwipeToReply(row, bubble, replyBtn, msg, mine);

  lastRenderedSenderId = msg.sender_id;
  lastRowElement = row;
  messageRowById[msg.id] = row;
}

// ---------- Swipe-to-reply (mobile) ----------
// Left-swiping a message bubble slides it left and fades in the reply
// icon in the space that opens up; releasing past the threshold triggers
// the reply. On desktop the icon is revealed on hover instead (see
// .msg-row:hover in style.css).
//
// "mine" bubbles sit last in the row (anchored to the right edge), so
// growing the icon's width already reflows the bubble left on its own —
// no transform needed there. "theirs" bubbles sit first (anchored to the
// left edge), so the reflow alone doesn't move them; those get an
// explicit transform so they visibly slide too.
function attachSwipeToReply(row, bubble, replyBtn, msg, mine) {
  const THRESHOLD = 56; // px of drag needed to trigger reply on release
  const MAX_REVEAL = 40; // cap on how far the bubble slides / how wide the icon opens
  const SLOP = 8; // px of movement before we decide horizontal vs vertical

  let startX = 0;
  let startY = 0;
  let dragging = false; // touch is active on this row
  let swiping = false; // we've committed to a horizontal swipe
  let dragDistance = 0; // uncapped left-drag distance, used for the threshold check

  // Re-applies the stylesheet's transitions (including the theme cross-fade
  // properties) after touchstart blanked them out to "none" for drag
  // responsiveness. Shared by endSwipe() and the vertical-scroll-cancel path
  // below, since both leave the row in a state that needs the same restore.
  function restoreTransitions() {
    replyBtn.style.transition = "width 0.18s ease, padding 0.18s ease, opacity 0.15s ease, background-color 0.3s ease, color 0.3s ease";
    bubble.style.transition = mine
      ? "background-color 0.3s ease, color 0.3s ease"
      : "transform 0.18s ease, background-color 0.3s ease, color 0.3s ease";
    if (!mine) {
      replyBtn.style.transition += ", transform 0.18s ease";
    }
  }

  row.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    swiping = false;
    dragDistance = 0;
    bubble.style.transition = "none";
    replyBtn.style.transition = "none";
  }, { passive: true });

  row.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!swiping) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical scroll — let the page handle it, not us. Restore the
        // transitions touchstart blanked out: dragging=false makes
        // endSwipe() a no-op on touchend, so without this the row is left
        // with transition:none until it's touched again, and its bubble
        // snaps instantly on the next theme toggle instead of cross-fading.
        dragging = false;
        restoreTransitions();
        return;
      }
      swiping = true;
    }

    // Only left swipes reveal the icon. Its width growing opens real
    // layout space right behind the bubble, so the two can never overlap.
    // "mine" bubbles reflow left on their own as that space opens up;
    // "theirs" bubbles need an explicit slide since they're anchored left.
    dragDistance = dx < 0 ? -dx : 0;
    const reveal = Math.min(dragDistance, MAX_REVEAL);
    if (!mine) {
      bubble.style.transform = `translateX(${-reveal}px)`;
      // The trigger sits right after the bubble in the DOM/flex flow, so its
      // un-transformed position stays anchored where the bubble *used* to be
      // even as the bubble itself slides left. Give it the same transform so
      // it rides along with the bubble instead of just widening in place.
      replyBtn.style.transform = `translateX(${-reveal}px)`;
    }
    replyBtn.style.width = reveal + "px";
    replyBtn.style.padding = (reveal * 0.15).toFixed(1) + "px"; // scales to 6px at MAX_REVEAL, same as the hover state
    replyBtn.style.opacity = Math.min(1, dragDistance / THRESHOLD).toFixed(2);
    e.preventDefault();
  }, { passive: false });

  function endSwipe() {
    if (!dragging) return;
    dragging = false;
    // Mirrors .reply-trigger's stylesheet transition, including the theme
    // properties: this inline style overrides the stylesheet, so omitting
    // them here would leave a swiped message's reply icon outside the
    // light/dark cross-fade.
    restoreTransitions();
    replyBtn.style.width = "0px";
    replyBtn.style.padding = "0px";
    replyBtn.style.opacity = "0";
    if (!mine) {
      // Same reasoning as replyBtn above: inline transition overrides the
      // universal theme transition, so include the theme properties here too.
      bubble.style.transform = "translateX(0)";
      replyBtn.style.transform = "translateX(0)";
    }
    if (swiping && dragDistance >= THRESHOLD) {
      startReply(msg);
    }
    swiping = false;
  }

  row.addEventListener("touchend", endSwipe);
  row.addEventListener("touchcancel", endSwipe);
}

// ---------- Reply-to ----------
function startReply(msg) {
  replyingTo = msg;
  replyPreviewName.textContent = msg.sender_id === currentUser?.id ? "You" : profileCache[msg.sender_id] || "Someone";
  replyPreviewText.textContent = msg.body ? truncate(msg.body, 80) : msg.media_path ? "📷 Photo" : "";
  showEl(replyPreview);
  messageInput.focus();
}

function cancelReply() {
  replyingTo = null;
  hideEl(replyPreview);
}

replyPreviewCancel.addEventListener("click", cancelReply);

function isNearBottom() {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
  unseenWhileScrolledUp = 0;
  updateJumpBottom();
}

// Shown whenever the user has scrolled up into history — not just when new
// messages arrived while scrolled up — so it always offers a way back down.
// The count badge only appears on top of that when there's something unseen.
function updateJumpBottom() {
  const shouldShow = !isNearBottom();
  if (shouldShow !== jumpBottomVisible) {
    jumpBottomVisible = shouldShow;
    shouldShow ? showEl(jumpBottom) : hideEl(jumpBottom);
  }
  if (shouldShow) {
    const count = unseenWhileScrolledUp > 0 ? unseenWhileScrolledUp : "";
    if (jumpBottomCount.textContent != count) jumpBottomCount.textContent = count;
  }
}

// RAF-throttled: isNearBottom() reads scrollHeight/clientHeight, a forced
// layout pass that's expensive in a list full of content-visibility rows.
// Running it on every scroll event is what made scrolling stutter — coalesce
// to one check per frame, and only touch the button's DOM when its visibility
// or count actually changed.
let jumpBottomTick = false;
let jumpBottomVisible = false;

messageList.addEventListener("scroll", () => {
  if (jumpBottomTick) return;
  jumpBottomTick = true;
  requestAnimationFrame(() => {
    jumpBottomTick = false;
    if (isNearBottom() && unseenWhileScrolledUp > 0) {
      unseenWhileScrolledUp = 0;
    }
    updateJumpBottom();
  });
});

// Opening the reply strip, showing a composer error, or the mobile keyboard
// resizing the page all shrink the message list WITHOUT firing a scroll
// event — leaving the button's near-bottom state stale. Re-check whenever
// the list's box size changes (shares the scroll listener's RAF throttle).
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    if (jumpBottomTick) return;
    jumpBottomTick = true;
    requestAnimationFrame(() => {
      jumpBottomTick = false;
      updateJumpBottom();
    });
  }).observe(messageList);
} else {
  window.addEventListener("resize", updateJumpBottom);
}

jumpBottom.addEventListener("click", () => {
  messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  unseenWhileScrolledUp = 0;
  jumpBottomVisible = false;
  hideEl(jumpBottom);
});


document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Messages that arrived while the tab was hidden (so weren't marked
    // seen) get read now that the user is actually looking at the chat.
    if (currentPartner) markConversationSeen();
    // The realtime socket may not have survived the tab being suspended:
    // rebuild dead channels and re-sync the list instead of sitting stale.
    if (currentUser) {
      ensureRealtime();
      loadChatSummaries();
    }
  }
});

// ---------- Periodic background sync ----------
// Safety net under realtime, running only while the tab is visible:
// - rebuild any dead realtime channel (ensureRealtime),
// - re-fetch chat summaries so nothing the websocket missed stays hidden
//   longer than one interval,
// - re-check that this account still exists server-side, so a user deleted
//   from Supabase auth gets logged out even if the realtime DELETE event
//   was missed while the channel was down.
setInterval(() => {
  if (!currentUser || document.visibilityState !== "visible") return;
  ensureRealtime();
  verifyAccountExists();
  loadChatSummaries();
}, 30000);

async function verifyAccountExists() {
  if (!currentUser) return;
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("id", currentUser.id)
    .maybeSingle();
  // Only a definite "no row" logs out — a network/permission error must not.
  if (!error && !data) handleProfileDeleted(currentUser.id);
}

// ---------- Composer errors ----------
// Failed sends/uploads are otherwise silent (the input is already cleared by
// then), which reads as the app eating the message. Show a short inline
// banner instead, and clear it as soon as the user tries again.
let composerErrorTimer = null;

function showComposerError(text) {
  composerError.textContent = text;
  showEl(composerError);
  clearTimeout(composerErrorTimer);
  composerErrorTimer = setTimeout(hideComposerError, 6000);
}

function hideComposerError() {
  // Text is dropped when the fade-out finishes, not immediately, so the
  // banner doesn't collapse mid-animation.
  hideEl(composerError);
  clearTimeout(composerErrorTimer);
  clearTimeout(composerError._fadeTimer);
  composerError._fadeTimer = setTimeout(() => { composerError.textContent = ""; }, FADE_MS);
}

// ---------- Sending ----------
// Removes an optimistic bubble that never made it to the server (send failed).
function removePendingMessage(tempId) {
  const row = messageRowById[tempId];
  if (row) {
    if (lastRowElement === row) lastRowElement = null;
    row.remove();
    delete messageRowById[tempId];
  }
  delete messageCache[tempId];
}

// Swaps an optimistic bubble's temp id for the real one once the insert
// confirms, and clears its faded/pending tick. Mutates optimisticMsg in
// place (rather than replacing it) so anything already holding a reference
// to it — e.g. a reply preview started against it — picks up the real id
// automatically.
function resolvePendingMessage(optimisticMsg, realMsg) {
  const tempId = optimisticMsg.id;
  const pendingRow = messageRowById[tempId];
  delete messageCache[tempId];
  delete messageRowById[tempId];

  if (messageRowById[realMsg.id]) {
    // Realtime's echo of this same insert already rendered it first (rare
    // race) — drop the now-redundant optimistic bubble instead of showing
    // the message twice.
    if (pendingRow) pendingRow.remove();
    return;
  }

  Object.assign(optimisticMsg, realMsg, { _pending: false });
  messageCache[optimisticMsg.id] = optimisticMsg;
  if (pendingRow) {
    messageRowById[optimisticMsg.id] = pendingRow;
    pendingRow.dataset.msgId = optimisticMsg.id;
    const tick = pendingRow.querySelector(".tick");
    if (tick) {
      // The optimistic bubble rendered the clock, not a tick — swap the icon
      // itself, not just the opacity.
      tick.innerHTML = TICK_SVG_SINGLE;
      tick.classList.remove("pending");
    }
  }
}

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  const replyId = replyingTo?.id || null;
  messageInput.value = "";
  hideComposerError();

  // Show the bubble immediately (WhatsApp/Telegram-style) instead of
  // waiting on the round trip to the server and back through Realtime — the
  // tick starts faded and solidifies once the send is actually confirmed.
  const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const optimisticMsg = {
    id: tempId,
    sender_id: currentUser.id,
    recipient_id: currentPartner,
    body: text,
    media_path: null,
    media_type: null,
    reply_to: replyId,
    created_at: new Date().toISOString(),
    seen_at: null,
    _pending: true,
  };
  renderMessage(optimisticMsg);
  scrollToBottom();
  // Keep the chats-list preview in sync from the instant the bubble appears,
  // so going back shows the new message without waiting on any fetch.
  updateChatSummaryFor(optimisticMsg);

  // E2EE: lock the message to the partner's key (plus our own other devices)
  // before it leaves the device. Falls back to plaintext when the partner
  // has no published key yet (account created before E2EE, or signed up but
  // never signed in) so nothing gets lost — those rows just aren't secret.
  let rowBody = text;
  let notify = null;
  if (CircleCrypto.ready()) {
    const enc = await CircleCrypto.encryptOutgoing(currentPartner, { b: text, mk: null, mi: null }, text);
    if (enc) {
      rowBody = enc.body;
      notify = enc.notify;
    }
  }

  const { data, error } = await supabaseClient
    .from("messages")
    .insert({
      sender_id: currentUser.id,
      recipient_id: currentPartner,
      body: rowBody,
      reply_to: replyId,
      ...(notify ? { notify } : {}),
    })
    .select()
    .single();
  if (error) {
    console.error(error);
    // The message never made it to the server — drop the optimistic bubble
    // and put the text back so nothing is lost. The reply context was never
    // cancelled, so it stays for the retry.
    removePendingMessage(tempId);
    messageInput.value = text;
    showComposerError("Couldn't send — check your connection and try again.");
  } else {
    resolvePendingMessage(optimisticMsg, data);
    // data.body is the stored ciphertext; the in-memory view keeps the
    // plaintext we already rendered (same object reference, so anything
    // holding it — quotes, reply preview — sees readable text).
    optimisticMsg.body = text;
    // The optimistic entry above used a client timestamp; now that the real
    // row is back (with its server id/created_at), refresh the preview from it.
    updateChatSummaryFor(optimisticMsg);
    cancelReply();
  }
});

// ---------- Media attach ----------
// Compressing before upload (rather than sending the original) is what
// actually keeps the Supabase Storage free-tier quota (1GB) from filling up
// fast — a handful of full-resolution phone photos can eat most of that on
// their own.
const MAX_IMAGE_DIMENSION = 1600; // longest edge, px
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // cap after compression
const SKIP_COMPRESSION_BELOW_BYTES = 400 * 1024; // already small — not worth re-encoding

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function toJpegFilename(name) {
  return name.replace(/\.\w+$/, "") + ".jpg";
}

// Resizes to a max dimension and re-encodes as JPEG. Falls back to the
// original file untouched if anything about compression goes wrong, or if
// the "compressed" result would actually end up bigger.
async function compressImage(file) {
  // Canvas only captures a single frame, so redrawing an animated GIF onto
  // one would silently strip its animation — leave those alone.
  if (file.type === "image/gif") return file;
  if (file.size <= SKIP_COMPRESSION_BELOW_BYTES) return file;

  try {
    const img = await loadImageFromFile(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], toJpegFilename(file.name), { type: "image/jpeg" });
  } catch (err) {
    console.error(err);
    return file;
  }
}

attachButton.addEventListener("click", () => attachInput.click());

attachInput.addEventListener("change", async () => {
  const file = attachInput.files[0];
  attachInput.value = "";
  if (!file) return;
  hideComposerError();

  // The picker filters to images via accept="image/*", but that's a hint,
  // not a guarantee — drag-dropped or re-named files still come through.
  if (!file.type.startsWith("image/")) {
    showComposerError("Only image files can be sent.");
    return;
  }

  const upload = await compressImage(file);

  if (upload.size > MAX_UPLOAD_BYTES) {
    showComposerError("That image is too large even after compression — please choose a smaller one.");
    return;
  }

  const replyId = replyingTo?.id || null;
  const path = `${currentUser.id}/${Date.now()}-${upload.name}`;
  // E2EE: encrypt the image bytes with a one-off AES key before upload —
  // Storage only ever holds ciphertext. The key travels inside the encrypted
  // message payload below.
  let uploadData = upload;
  let mk = null;
  let mi = null;
  if (CircleCrypto.ready()) {
    const enc = await CircleCrypto.encryptFileForSend(upload);
    uploadData = enc.data;
    mk = enc.mk;
    mi = enc.mi;
  }
  const { error: uploadError } = await supabaseClient.storage
    .from("chat-media")
    .upload(path, uploadData);
  if (uploadError) {
    console.error(uploadError);
    showComposerError("Couldn't upload the image — check your connection and try again.");
    return; // no message row was created, so the reply context can stay put
  }

  let rowBody = null;
  let notify = null;
  if (CircleCrypto.ready() && mk) {
    const enc = await CircleCrypto.encryptOutgoing(currentPartner, { b: null, mk, mi }, "📷 Photo");
    if (enc) {
      rowBody = enc.body;
      notify = enc.notify;
    }
  }

  const { error } = await supabaseClient
    .from("messages")
    .insert({
      sender_id: currentUser.id,
      recipient_id: currentPartner,
      body: rowBody,
      media_path: path,
      media_type: upload.type,
      reply_to: replyId,
      ...(notify ? { notify } : {}),
    });
  if (error) {
    console.error(error);
    showComposerError("The image uploaded, but the message couldn't be sent. Try attaching it again.");
  } else {
    cancelReply();
  }
});

// ---------- Service worker + push notifications ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      // Only ask for push once the user is actually signed in and in the chat.
      // onAuthStateChange also fires for TOKEN_REFRESHED whenever the tab
      // regains focus, so without the guard inside subscribeToPush that would
      // re-request notification permission (and re-upsert) on every focus.
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        if (session?.user) subscribeToPush(registration, session.user.id);
      });
    } catch (err) {
      console.error(err);
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

let pushSubscribeInFlight = false;
let pushSubscribedForUser = null;

async function subscribeToPush(registration, userId) {
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
    const { error } = await supabaseClient.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: "endpoint" }
    );
    if (error) {
      console.error(error);
      return;
    }
    pushSubscribedForUser = userId;
  } finally {
    pushSubscribeInFlight = false;
  }
}

// ---------- Keep layout height accurate when the mobile keyboard opens/closes ----------
// visualViewport fires resize AND scroll in bursts while the keyboard animates.
// Applying each event immediately would write the CSS vars — and re-layout the
// page — several times per frame with values that can momentarily disagree,
// which is the one-frame jitter as the composer follows the keyboard. Coalesce
// to one update per animation frame and only touch the DOM on real changes.
let viewportSyncQueued = false;
let appliedAppHeight = null;
let appliedAppOffset = null;

// Layout-viewport height at the previous sync. Browsers that RESIZE the page
// for the keyboard (Android Chrome with interactive-widget=resizes-content)
// briefly report a non-zero visual-viewport offsetTop mid-animation even
// though the layout viewport is already the source of truth — pinning the
// screens to that transient offset via translateY is a single mid-animation
// jump. Only browsers that SCROLL instead (iOS Safari, layout viewport
// unchanged) genuinely need the pinning, so apply it only when the layout
// viewport did not just change size.
let lastLayoutHeight = document.documentElement.clientHeight;

// While a pure viewport scroll moves the pinning offset (keyboard already
// open, user switched to another input), the transform transition on .screen
// would animate the change and fight the browser's own movement — the
// field-switch stutter on the auth form. Suppress the ease for these steps
// and restore it once the scrolling settles, so the keyboard open/close
// animation (which changes height) is still eased.
let scrollEaseTimer = null;

function suppressTransformEase() {
  document.documentElement.classList.add("kb-following-scroll");
  clearTimeout(scrollEaseTimer);
  scrollEaseTimer = setTimeout(() => {
    document.documentElement.classList.remove("kb-following-scroll");
  }, 250);
}

function restoreTransformEase() {
  clearTimeout(scrollEaseTimer);
  document.documentElement.classList.remove("kb-following-scroll");
}

function syncViewportVars() {
  viewportSyncQueued = false;
  const vv = window.visualViewport;
  const layoutHeight = document.documentElement.clientHeight;
  const layoutResized = layoutHeight !== lastLayoutHeight;
  lastLayoutHeight = layoutHeight;

  const height = `${vv ? vv.height : window.innerHeight}px`;
  const offsetTop = !layoutResized && vv && vv.offsetTop ? `${vv.offsetTop}px` : "0px";

  const heightChanged = height !== appliedAppHeight;
  if (heightChanged) {
    // Keyboard opening or closing: the offset rides along with the height
    // change, and this is the one motion worth easing.
    appliedAppHeight = height;
    document.documentElement.style.setProperty("--app-height", height);
    restoreTransformEase();
    if (offsetTop !== appliedAppOffset) {
      appliedAppOffset = offsetTop;
      document.documentElement.style.setProperty("--app-offset-top", offsetTop);
    }
  } else if (offsetTop !== appliedAppOffset) {
    // Offset moved on its own — the browser scrolled the visual viewport
    // (e.g. to reveal the newly focused field). Track it with no ease.
    appliedAppOffset = offsetTop;
    document.documentElement.style.setProperty("--app-offset-top", offsetTop);
    suppressTransformEase();
  }

  // Keep the composer in view when the keyboard is open
  if (document.activeElement === messageInput) {
    scrollToBottom();
  }
}

function setAppHeight() {
  if (viewportSyncQueued) return;
  viewportSyncQueued = true;
  requestAnimationFrame(syncViewportVars);
}
setAppHeight();
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", setAppHeight);
  window.visualViewport.addEventListener("scroll", setAppHeight);
} else {
  window.addEventListener("resize", setAppHeight);
}
