// ChatApp — the app orchestrator, ported from the original single-script
// vanilla app. All state lives here and flows down to presentational
// screens; Supabase calls, realtime channel lifecycle, optimistic sends,
// E2EE wiring and history handling are direct ports of the original logic.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabaseClient } from "@/lib/supabase";
import { CircleCrypto } from "@/lib/crypto";
import { resetPushState, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { compressImage, compressMedia, MAX_UPLOAD_BYTES, MAX_BINARY_UPLOAD_BYTES, MAX_MEDIA_INPUT_BYTES, formatBytes } from "@/lib/media";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme";
import { fadeClass, FADE_MS, useFade } from "@/lib/fade";
import { useViewportHeight } from "@/lib/viewport";
import {
  attachmentPreview,
  clearStoredOpenChat,
  dayLabel,
  getStoredOpenChat,
  isDesktopLayout,
  previewText,
  setStoredOpenChat,
  timeLabel,
  truncate,
  usernameToFakeEmail,
  USERNAME_MIN_LENGTH,
} from "@/lib/utils";
import type { ChatSummary, MessageRow, MessageView, Profile } from "@/lib/types";
import AuthScreen, { type AuthMode } from "./AuthScreen";
import ChatsScreen, { type ChatListItem } from "./ChatsScreen";
import ChatScreen, { type ChatScreenApi, type DerivedRow } from "./ChatScreen";
import SettingsOverlay from "./SettingsOverlay";
import { ChatPlaceholderIcon } from "./icons";

export default function ChatApp() {
  // ---------- core session state ----------
  const [currentUser, setUserState] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const [currentPartner, setPartnerState] = useState<string | null>(null);
  const currentPartnerRef = useRef<string | null>(null);

  // ---------- auth UI ----------
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const authModeRef = useRef<AuthMode>("signin");
  const [prefillUsername, setPrefillUsername] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const justSignedUpRef = useRef(false);
  const pendingPasswordRef = useRef<string | null>(null);

  // ---------- screen visibility (fade state driven) ----------
  const [authShown, setAuthShown] = useState(true);
  const [chatsShown, setChatsShown] = useState(false);
  const [chatShown, setChatShown] = useState(false);
  // While true, the <head> script's has-session/has-open-chat CSS overrides
  // stay in force and cover every paint until React's own screen state is
  // authoritative — see the layout effect that consumes this in enterApp.
  const [headOverrides, setHeadOverrides] = useState(true);
  const [placeholderShown, setPlaceholderShown] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const desktopChatCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- caches ----------
  const [profileCache, setProfileCache] = useState<Record<string, string>>({});
  const profileCacheRef = useRef<Record<string, string>>({});
  const usernameCacheRef = useRef<Record<string, string>>({});
  const messageCacheRef = useRef<Record<string, MessageView>>({});
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeBlobUrlsRef = useRef<Set<string>>(new Set());

  // ---------- data ----------
  const [chatSummaries, setChatSummaries] = useState<Record<string, ChatSummary>>({});
  const chatSummariesRef = useRef<Record<string, ChatSummary>>({});
  const [messages, setMessages] = useState<MessageView[]>([]);
  const conversationLoadSeqRef = useRef(0);
  const pendingOutgoingRef = useRef<MessageView[]>([]);

  // ---------- realtime ----------
  const messagesChannelRef = useRef<RealtimeChannel | null>(null);
  const profilesChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const messagesChannelSinceRef = useRef(0);
  const profilesChannelSinceRef = useRef(0);
  const presenceChannelSinceRef = useRef(0);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentRef = useRef(0);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [activeTypers, setActiveTypersState] = useState<Record<string, string>>({});
  const activeTypersRef = useRef<Record<string, string>>({});
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const summaryResyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- conversation UI ----------
  const [replyingTo, setReplyingToState] = useState<MessageView | null>(null);
  const replyingToRef = useRef<MessageView | null>(null);
  const [composerErrorVisible, setComposerErrorVisible] = useState(false);
  const [composerErrorText, setComposerErrorText] = useState("");
  const composerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerErrorFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- search ----------
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searchEmpty, setSearchEmpty] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const searchClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------- misc ----------
  const [theme, setThemeState] = useState<Theme>("dark");
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const chatScreenApiRef = useRef<ChatScreenApi | null>(null);
  const setAppHeight = useViewportHeight(() => {
    // Keep the composer in view when the keyboard is open
    if (document.activeElement?.id === "message-input") chatScreenApiRef.current?.scrollToBottom();
  });

  // ---------- state setters that keep refs in sync ----------
  const setUser = useCallback((user: User | null) => {
    currentUserRef.current = user;
    setUserState(user);
  }, []);
  const setPartner = useCallback((id: string | null) => {
    currentPartnerRef.current = id;
    setPartnerState(id);
  }, []);
  const applyProfileCache = useCallback((next: Record<string, string>) => {
    profileCacheRef.current = next;
    setProfileCache(next);
  }, []);
  const applySummaries = useCallback((next: Record<string, ChatSummary>) => {
    chatSummariesRef.current = next;
    setChatSummaries(next);
  }, []);
  const setReplying = useCallback((msg: MessageView | null) => {
    replyingToRef.current = msg;
    setReplyingToState(msg);
  }, []);
  const syncTypers = useCallback((next: Record<string, string>) => {
    activeTypersRef.current = next;
    setActiveTypersState(next);
  }, []);

  // ---------- derived: chats list ----------
  const chatListItems = useMemo<ChatListItem[]>(() => {
    const user = currentUser;
    if (!user) return [];
    const partners = Object.keys(chatSummaries).sort(
      (a, b) =>
        new Date(chatSummaries[b].last?.created_at ?? 0).getTime() -
        new Date(chatSummaries[a].last?.created_at ?? 0).getTime()
    );
    return partners.map((partner) => {
      const s = chatSummaries[partner];
      const last = s.last;
      return {
        partner,
        name: profileCache[partner] || "Someone",
        time: last ? timeLabel(last.created_at) : "",
        preview: s.preview != null ? s.preview : last ? previewText(last) : "",
        mineLast: !!last && last.sender_id === user.id,
        seenLast: !!last?.seen_at,
        unread: s.unread,
        active: partner === currentPartner,
      };
    });
  }, [chatSummaries, profileCache, currentPartner, currentUser]);

  // ---------- derived: message rows (grouping, day dividers, quotes) ----------
  const derivedRows = useMemo<DerivedRow[]>(() => {
    const myId = currentUser?.id ?? null;
    const cache = messageCacheRef.current;
    const rows: DerivedRow[] = [];
    let prevSender: string | null = null;
    let prevDay: string | null = null;
    for (const msg of messages) {
      const day = new Date(msg.created_at).toDateString();
      if (day !== prevDay) {
        rows.push({ kind: "divider", id: "day-" + day, label: dayLabel(msg.created_at) });
        prevDay = day;
        prevSender = null; // force a fresh group after a day divider
      }
      const mine = myId != null && msg.sender_id === myId;
      const grouped = prevSender === msg.sender_id;
      const quotedMsg = msg.reply_to ? cache[msg.reply_to] ?? null : null;
      rows.push({
        kind: "msg",
        msg,
        mine,
        grouped,
        groupLast: true,
        animateIn: !!msg._animate,
        showName: !mine && !grouped,
        senderName: profileCache[msg.sender_id] || "Someone",
        quotedMsg,
        quotedName: quotedMsg
          ? quotedMsg.sender_id === myId
            ? "You"
            : profileCache[quotedMsg.sender_id] || "Someone"
          : "",
      });
      prevSender = msg.sender_id;
    }
    // Every row of a same-sender run except the last loses its tail class.
    for (let i = 0; i < rows.length - 1; i++) {
      const r = rows[i];
      const n = rows[i + 1];
      if (r.kind === "msg" && n.kind === "msg" && n.msg.sender_id === r.msg.sender_id) r.groupLast = false;
    }
    return rows;
  }, [messages, profileCache, currentUser]);

  const typingText = useMemo<string | null>(() => {
    const names = Object.values(activeTypers);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names.length} people are typing…`;
  }, [activeTypers]);

  const partnerName = currentPartner ? profileCache[currentPartner] || "…" : "";
  const partnerTip =
    currentPartner && usernameCacheRef.current[currentPartner]
      ? `@${usernameCacheRef.current[currentPartner]}`
      : null;
  const partnerOnline = !!(currentPartner && onlineUsers.has(currentPartner));
  const replyingName = replyingTo
    ? replyingTo.sender_id === currentUser?.id
      ? "You"
      : profileCache[replyingTo.sender_id] || "Someone"
    : "";

  // ---------- composer error banner ----------
  // Failed sends/uploads are otherwise silent (the input is already cleared
  // by then), which reads as the app eating the message. Show a short inline
  // banner instead, and clear it as soon as the user tries again.
  const hideComposerError = useCallback(() => {
    setComposerErrorVisible(false);
    if (composerErrorTimerRef.current) clearTimeout(composerErrorTimerRef.current);
    if (composerErrorFadeRef.current) clearTimeout(composerErrorFadeRef.current);
    // Text is dropped when the fade-out finishes, not immediately, so the
    // banner doesn't collapse mid-animation.
    composerErrorFadeRef.current = setTimeout(() => setComposerErrorText(""), FADE_MS);
  }, []);

  const showComposerError = useCallback(
    (text: string) => {
      setComposerErrorText(text);
      setComposerErrorVisible(true);
      if (composerErrorFadeRef.current) clearTimeout(composerErrorFadeRef.current);
      if (composerErrorTimerRef.current) clearTimeout(composerErrorTimerRef.current);
      composerErrorTimerRef.current = setTimeout(() => hideComposerError(), 6000);
    },
    [hideComposerError]
  );

  // ---------- blob url tracking / row registration ----------
  const trackBlobUrl = useCallback((url: string): string => {
    if (url && url.startsWith("blob:")) activeBlobUrlsRef.current.add(url);
    return url;
  }, []);

  const registerRow = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // ---------- profiles ----------
  const loadProfiles = useCallback(async () => {
    const user = currentUserRef.current;
    if (!user) return;
    const { data, error } = await supabaseClient.from("profiles").select("id, display_name, username, public_key");
    if (error) return console.error(error);
    const rows = (data ?? []) as Profile[];
    const pc: Record<string, string> = {};
    const uc: Record<string, string> = {};
    for (const p of rows) {
      pc[p.id] = p.display_name;
      if (p.username) uc[p.id] = p.username;
      CircleCrypto.cachePublicKey(p.id, p.public_key);
    }
    usernameCacheRef.current = uc;
    applyProfileCache(pc);
  }, [applyProfileCache]);

  // If a message comes in from a sender we don't have cached (e.g. they
  // signed up after we already loaded the profile list), fetch just that
  // one profile instead of showing "Someone" forever.
  const ensureProfileCached = useCallback(
    async (id: string): Promise<string | null> => {
      if (profileCacheRef.current[id]) return profileCacheRef.current[id];
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, username, public_key")
        .eq("id", id)
        .single();
      if (error || !data) return null;
      const p = data as Profile;
      applyProfileCache({ ...profileCacheRef.current, [id]: p.display_name });
      if (p.username) usernameCacheRef.current = { ...usernameCacheRef.current, [id]: p.username };
      CircleCrypto.cachePublicKey(id, p.public_key);
      return p.display_name;
    },
    [applyProfileCache]
  );

  // ---------- chat summaries ----------
  async function setSummaryPreview(s: ChatSummary): Promise<string> {
    if (!s.last) return "";
    try {
      const view = await CircleCrypto.decryptRow(s.last);
      return previewText(view);
    } catch {
      return "";
    }
  }

  const loadChatSummaries = useCallback(async () => {
    const user = currentUserRef.current;
    if (!user) return;
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, sender_id, recipient_id, body, media_path, created_at, seen_at")
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return console.error(error);
    const rows = (data ?? []) as MessageRow[];

    // Builds the conversation list from the most recent messages: group by
    // partner (whoever of sender/recipient isn't me), keep each partner's
    // latest message as the row preview, and count messages I received but
    // haven't seen.
    const next: Record<string, ChatSummary> = {};
    for (const msg of rows) {
      const partner = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id;
      const s = next[partner] ?? (next[partner] = { partner, last: null, unread: 0, preview: null });
      if (!s.last) s.last = msg;
      if (msg.recipient_id === user.id && !msg.seen_at) s.unread++;
    }
    // Last messages of conversations can be encrypted — resolve each preview
    // (instant no-op for legacy plaintext rows) before painting the list.
    await Promise.all(Object.values(next).map(async (s) => (s.preview = await setSummaryPreview(s))));
    if (currentUserRef.current !== user) return; // signed out mid-load
    applySummaries(next);
  }, [applySummaries]);

  // A new/updated message arrived while we're not inside that conversation:
  // refresh the affected row's preview and unread badge.
  const updateChatSummaryFor = useCallback(
    (msg: MessageRow) => {
      const user = currentUserRef.current;
      if (!user) return;
      const partner = msg.sender_id === user.id ? msg.recipient_id : msg.sender_id;
      const s = chatSummariesRef.current[partner] ?? { partner, last: null, unread: 0, preview: null };
      const nextS: ChatSummary = { ...s };
      let changed = false;

      if (!s.last || new Date(msg.created_at) >= new Date(s.last.created_at)) {
        nextS.last = msg;
        // Blank placeholder while the preview decrypts (near-instant for
        // plaintext); the async resolution below re-renders with real text.
        nextS.preview = "";
        changed = true;
        void setSummaryPreview(nextS).then((preview) => {
          const cur = chatSummariesRef.current[partner];
          if (!cur || cur.last !== nextS.last) return; // superseded meanwhile
          applySummaries({ ...chatSummariesRef.current, [partner]: { ...cur, preview } });
        });
      }
      if (msg.recipient_id === user.id && !msg.seen_at && currentPartnerRef.current !== partner) {
        nextS.unread = s.unread + 1;
        changed = true;
      }
      // A brand-new contact's first message would otherwise sit as "Someone"
      // until the next full reload — pull the name and repaint the row with it.
      if (!profileCacheRef.current[partner]) {
        void ensureProfileCached(partner).then((name) => {
          if (name) applySummaries({ ...chatSummariesRef.current });
        });
      }
      if (changed) applySummaries({ ...chatSummariesRef.current, [partner]: nextS });
    },
    [applySummaries, ensureProfileCached]
  );

  // Coalesces bursts of message DELETEs (a whole conversation wiped at once)
  // into a single summaries refresh.
  const resyncChatSummariesSoon = useCallback(() => {
    if (summaryResyncTimerRef.current) clearTimeout(summaryResyncTimerRef.current);
    summaryResyncTimerRef.current = setTimeout(() => void loadChatSummaries(), 150);
  }, [loadChatSummaries]);

  // ---------- message list ----------
  const resetMessages = useCallback(() => {
    for (const url of activeBlobUrlsRef.current) URL.revokeObjectURL(url);
    activeBlobUrlsRef.current = new Set();
    pendingOutgoingRef.current = [];
    setMessages([]);
  }, []);

  // Batch render of existing history: no per-row entry animation (see the
  // .animate-in rule) — otherwise the whole list visibly flickers up whenever
  // it re-renders after a refresh.
  const renderAllMessages = useCallback(
    async (data: MessageRow[], expectedSeq: number): Promise<boolean> => {
      // Decrypt every row first (no-op for legacy plaintext rows) so rows
      // render in order with plaintext bodies, and messageCache holds
      // decrypted views for later quotes. Encrypted photos start
      // downloading/decrypting inside their row component; the row itself is
      // placed synchronously here.
      const views = await Promise.all(data.map((row) => CircleCrypto.decryptRow(row)));
      if (expectedSeq !== conversationLoadSeqRef.current) return false;
      resetMessages();
      for (const v of views) messageCacheRef.current[v.id] = v;
      setMessages(views.map((v) => ({ ...v, _animate: false })));
      return true;
    },
    [resetMessages]
  );

  // ---------- Load message history (current conversation) ----------
  const loadMessages = useCallback(
    async (includeMessageId: string | null = null) => {
      const partnerAtStart = currentPartnerRef.current;
      const userAtStart = currentUserRef.current?.id;
      if (!partnerAtStart || !userAtStart) return;
      const seq = ++conversationLoadSeqRef.current;

      // Order newest-first so limit(200) keeps the most recent 200 messages,
      // then reverse back to oldest-first for rendering. Ordering ascending
      // before the limit (the old behavior) kept the OLDEST 200 messages in
      // any conversation past that size, silently dropping every recent
      // message and leaving the view scrolled to the bottom of a stale batch.
      const { data, error } = await supabaseClient
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${userAtStart},recipient_id.eq.${partnerAtStart}),and(sender_id.eq.${partnerAtStart},recipient_id.eq.${userAtStart})`
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (seq !== conversationLoadSeqRef.current || currentPartnerRef.current !== partnerAtStart) return;
      if (error) return console.error(error);

      const messagesList = (data ?? []) as MessageRow[];

      // A reply can point to a message older than the newest 200. When the
      // user taps that quote, fetch the exact target and include it in this
      // render so there is a real DOM row for scrollToMessage() to jump to.
      // The conversation check below is deliberate: the id comes from a
      // reply_to field, so never render a row from some unrelated
      // conversation even if an id is supplied.
      if (includeMessageId && !messagesList.some((msg) => msg.id === includeMessageId)) {
        const { data: target, error: targetError } = await supabaseClient
          .from("messages")
          .select("*")
          .eq("id", includeMessageId)
          .maybeSingle();
        if (seq !== conversationLoadSeqRef.current || currentPartnerRef.current !== partnerAtStart) return;
        const t = target as MessageRow | null;
        const targetBelongsToConversation =
          t &&
          ((t.sender_id === userAtStart && t.recipient_id === partnerAtStart) ||
            (t.sender_id === partnerAtStart && t.recipient_id === userAtStart));
        if (!targetError && targetBelongsToConversation) {
          messagesList.push(t);
        } else if (targetError) {
          console.error(targetError);
        }
      }

      // Pre-populate messageCache for any quoted messages older than the
      // 200-row window so reply previews show the original author and text
      // instead of a generic fallback.
      const loadedIds = new Set(messagesList.map((m) => m.id));
      const missingReplyIds = [
        ...new Set(
          messagesList
            .map((m) => m.reply_to)
            .filter((id): id is string => !!id && !loadedIds.has(id) && !messageCacheRef.current[id])
        ),
      ];
      if (missingReplyIds.length > 0) {
        const { data: quotedRows } = await supabaseClient.from("messages").select("*").in("id", missingReplyIds);
        if (seq !== conversationLoadSeqRef.current || currentPartnerRef.current !== partnerAtStart) return;
        const quoted = (quotedRows ?? []) as MessageRow[];
        if (quoted.length > 0) {
          const decryptedQuotes = await Promise.all(quoted.map((r) => CircleCrypto.decryptRow(r)));
          if (seq !== conversationLoadSeqRef.current || currentPartnerRef.current !== partnerAtStart) return;
          for (const q of decryptedQuotes) {
            if (
              (q.sender_id === userAtStart && q.recipient_id === partnerAtStart) ||
              (q.sender_id === partnerAtStart && q.recipient_id === userAtStart)
            ) {
              messageCacheRef.current[q.id] = q;
            }
          }
        }
      }

      // The targeted message may be much older than the normal history
      // window, so sort after adding it to keep the chronological message
      // order intact.
      messagesList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const rendered = await renderAllMessages(messagesList, seq);
      if (!rendered) return;

      // Anchor the opened conversation at the newest message. The old
      // synchronous scrollToBottom() call here was removed: renderAllMessages()
      // only QUEUES the rows via setMessages — React commits them to the DOM
      // asynchronously — so that call measured a still-empty list and clamped
      // to scrollTop 0, and the guarded re-asserts below could never recover
      // (a freshly-tall list at scrollTop 0 is "not near bottom") — the view
      // stayed parked on the oldest messages. ChatScreen now anchors itself
      // in a layout effect keyed on convoKey (post-commit, pre-paint), which
      // puts the latest message on screen from the first frame. These
      // re-asserts then just hold the bottom against late height changes
      // (images/content-visibility resolving), guarded so a user who scrolled
      // up immediately is never dragged back down.
      if (!includeMessageId) {
        requestAnimationFrame(() => {
          if (chatScreenApiRef.current?.isNearBottom()) chatScreenApiRef.current?.scrollToBottom();
        });
        setTimeout(() => {
          if (chatScreenApiRef.current?.isNearBottom()) chatScreenApiRef.current?.scrollToBottom();
        }, 100);
        setTimeout(() => {
          if (chatScreenApiRef.current?.isNearBottom()) chatScreenApiRef.current?.scrollToBottom();
        }, 300);
      }
    },
    [renderAllMessages]
  );

  // Scrolls to and briefly highlights a message. A reply can target a
  // message outside the normal 200-message history window, so load that
  // exact message first when no rendered row exists yet.
  const scrollToMessage = useCallback(
    async (id: string, behavior: ScrollBehavior = "smooth") => {
      let row = rowRefs.current.get(id) ?? null;
      if (!row) {
        await loadMessages(id);
        row = rowRefs.current.get(id) ?? null;
      }
      // The target may have been deleted or may no longer be visible to this
      // user under RLS. In that case the quote simply does nothing.
      if (!row) return false;
      chatScreenApiRef.current?.scrollRowIntoView(row, behavior);
      row.classList.remove("highlight-flash");
      void row.offsetWidth;
      row.classList.add("highlight-flash");
      setTimeout(() => row.classList.remove("highlight-flash"), 1200);
      return true;
    },
    [loadMessages]
  );

  // ---------- Read receipts ----------
  // Marks everything my partner sent me in this conversation as seen. Called
  // when opening a chat and whenever a new message arrives while it's open.
  const markConversationSeen = useCallback(async () => {
    const user = currentUserRef.current;
    const partner = currentPartnerRef.current;
    if (!partner || !user) return;
    const { error } = await supabaseClient
      .from("messages")
      .update({ seen_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .eq("sender_id", partner)
      .is("seen_at", null);
    if (error) console.error(error);
  }, []);

  // ---------- Optimistic sends ----------
  // Removes an optimistic bubble that never made it to the server (send
  // failed).
  const removePendingMessage = useCallback((tempId: string) => {
    pendingOutgoingRef.current = pendingOutgoingRef.current.filter((m) => m.id !== tempId);
    setMessages((prev) => (prev.some((m) => m.id === tempId) ? prev.filter((m) => m.id !== tempId) : prev));
    delete messageCacheRef.current[tempId];
  }, []);

  // Swaps an optimistic bubble's temp id for the real one once the insert
  // confirms, and clears its faded/pending tick. Mutates optimisticMsg in
  // place (rather than replacing it) so anything already holding a reference
  // to it — e.g. a reply preview started against it — picks up the real id
  // automatically.
  const resolvePendingMessage = useCallback((optimisticMsg: MessageView, realMsg: MessageRow) => {
    const tempId = optimisticMsg.id;
    pendingOutgoingRef.current = pendingOutgoingRef.current.filter((m) => m.id !== tempId);
    delete messageCacheRef.current[tempId];

    if (rowRefs.current.has(realMsg.id)) {
      // Realtime's echo of this same insert already rendered it first (rare
      // race) — drop the now-redundant optimistic bubble instead of showing
      // the message twice.
      setMessages((prev) => (prev.some((m) => m.id === tempId) ? prev.filter((m) => m.id !== tempId) : prev));
      return;
    }

    Object.assign(optimisticMsg, realMsg, { _pending: false, _animate: false });
    messageCacheRef.current[optimisticMsg.id] = optimisticMsg;
    setMessages((prev) => prev.map((m) => (m.id === tempId ? optimisticMsg : m)));
  }, []);

  // ---------- Typing indicator (Realtime broadcast, no DB writes) ----------
  // One broadcast channel per user pair, so typing signals stay within that
  // conversation and don't leak into other chats.
  const pairChannelName = useCallback(
    (a: string, b: string) => `typing:${[a, b].sort().join(":")}`,
    []
  );

  const subscribeTyping = useCallback(() => {
    const user = currentUserRef.current;
    const partner = currentPartnerRef.current;
    if (!user || !partner) return;
    // Re-entering the same conversation shouldn't stack duplicate channels.
    if (typingChannelRef.current) supabaseClient.removeChannel(typingChannelRef.current);

    const channel = supabaseClient.channel(pairChannelName(user.id, partner), {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.user_id === currentUserRef.current?.id) return;
        showTyping(payload.user_id, payload.name);
      })
      .subscribe();
    typingChannelRef.current = channel;
  }, [pairChannelName]);

  function showTyping(userId: string, name: string): void {
    syncTypers({ ...activeTypersRef.current, [userId]: name });
    if (typingTimersRef.current[userId]) clearTimeout(typingTimersRef.current[userId]);
    typingTimersRef.current[userId] = setTimeout(() => clearTyping(userId), 3000);
  }

  const clearTyping = useCallback(
    (userId: string) => {
      if (userId in activeTypersRef.current) {
        const next = { ...activeTypersRef.current };
        delete next[userId];
        syncTypers(next);
      }
      if (typingTimersRef.current[userId]) {
        clearTimeout(typingTimersRef.current[userId]);
        delete typingTimersRef.current[userId];
      }
    },
    [syncTypers]
  );

  const onTyping = useCallback((value: string) => {
    const user = currentUserRef.current;
    const channel = typingChannelRef.current;
    if (!channel || !user || !value.trim()) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    channel.send({
      type: "broadcast",
      event: "typing",
      payload: { user_id: user.id, name: profileCacheRef.current[user.id] || "Someone" },
    });
  }, []);

  // ---------- Incoming messages ----------
  const handleIncomingMessage = useCallback(
    (msg: MessageView) => {
      const user = currentUserRef.current;
      if (!user) return;
      const mine = msg.sender_id === user.id;
      const partnerId = mine ? msg.recipient_id : msg.sender_id;
      const isOpenConversation =
        currentPartnerRef.current !== null && partnerId === currentPartnerRef.current;

      // If Realtime delivers our own insert before the HTTP .insert().select()
      // response resolves, bind it to the matching pending optimistic bubble
      // in-place instead of rendering a second bubble.
      if (mine && isOpenConversation && !rowRefs.current.has(msg.id) && pendingOutgoingRef.current.length > 0) {
        const idx = pendingOutgoingRef.current.findIndex(
          (p) =>
            p.recipient_id === msg.recipient_id &&
            (p.media_path ? p.media_path === msg.media_path : p.body === msg.body)
        );
        if (idx !== -1) {
          const pendingMsg = pendingOutgoingRef.current.splice(idx, 1)[0];
          resolvePendingMessage(pendingMsg, msg);
          updateChatSummaryFor(pendingMsg);
          return;
        }
      }

      // Own messages are already shown the instant they're sent (see the
      // composer's optimistic render below) — when Realtime's echo of that
      // same insert arrives a moment later, skip re-rendering it so it
      // doesn't show up twice.
      if (isOpenConversation && !rowRefs.current.has(msg.id)) {
        if (!profileCacheRef.current[msg.sender_id]) void ensureProfileCached(msg.sender_id);
        const wasNearBottom = chatScreenApiRef.current?.isNearBottom() ?? true;
        messageCacheRef.current[msg.id] = msg;
        setMessages((prev) => [...prev, { ...msg, _animate: true }]);
        // The scroll must wait for React to commit the new row (state updates
        // are async) — one animation frame lands after the commit.
        requestAnimationFrame(() => {
          if (wasNearBottom || mine) {
            chatScreenApiRef.current?.scrollToBottom();
          } else {
            chatScreenApiRef.current?.bumpUnseen();
          }
        });
        // The message arrived in the open chat — mark it seen right away,
        // but only if the tab is actually visible: a backgrounded tab doesn't
        // "see" anything (and its push notification shouldn't be contradicted
        // by an instant double tick for the sender).
        if (!mine && document.visibilityState === "visible") void markConversationSeen();
        // Someone's message arrived, so they're done typing
        clearTyping(msg.sender_id);
      }

      updateChatSummaryFor(msg);
    },
    [clearTyping, ensureProfileCached, markConversationSeen, resolvePendingMessage, updateChatSummaryFor]
  );

  // ---------- Reply-to ----------
  const startReply = useCallback(
    (msg: MessageView) => {
      setReplying(msg);
      chatScreenApiRef.current?.focusInput();
    },
    [setReplying]
  );

  const cancelReply = useCallback(() => setReplying(null), [setReplying]);

  // ---------- Sending ----------
  const sendMessage = useCallback(
    async (text: string) => {
      const user = currentUserRef.current;
      const targetPartner = currentPartnerRef.current;
      if (!text || !targetPartner || !user) return;
      const replyId = replyingToRef.current?.id ?? null;
      hideComposerError();

      // Show the bubble immediately (WhatsApp/Telegram-style) instead of
      // waiting on the round trip to the server and back through Realtime —
      // the tick starts faded and solidifies once the send is actually
      // confirmed.
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticMsg: MessageView = {
        id: tempId,
        sender_id: user.id,
        recipient_id: targetPartner,
        body: text,
        media_path: null,
        media_type: null,
        reply_to: replyId,
        created_at: new Date().toISOString(),
        seen_at: null,
        _pending: true,
      };
      pendingOutgoingRef.current.push(optimisticMsg);
      messageCacheRef.current[tempId] = optimisticMsg;
      setMessages((prev) => [...prev, { ...optimisticMsg, _animate: true }]);
      requestAnimationFrame(() => chatScreenApiRef.current?.scrollToBottom());
      // Keep the chats-list preview in sync from the instant the bubble
      // appears, so going back shows the new message without waiting on any
      // fetch.
      updateChatSummaryFor(optimisticMsg);

      // E2EE: lock the message to the partner's key (plus our own other
      // devices) before it leaves the device. Falls back to plaintext when
      // the partner has no published key yet (account created before E2EE,
      // or signed up but never signed in) so nothing gets lost — those rows
      // just aren't secret.
      let rowBody: string | null = text;
      let notify: string | null = null;
      if (CircleCrypto.ready()) {
        const enc = await CircleCrypto.encryptOutgoing(targetPartner, { b: text, mk: null, mi: null }, text);
        if (enc) {
          rowBody = enc.body;
          notify = enc.notify;
        }
      }

      const { data, error } = await supabaseClient
        .from("messages")
        .insert({
          sender_id: user.id,
          recipient_id: targetPartner,
          body: rowBody,
          reply_to: replyId,
          ...(notify ? { notify } : {}),
        })
        .select()
        .single();
      if (error) {
        console.error(error);
        // The message never made it to the server — drop the optimistic
        // bubble and put the text back so nothing is lost. The reply context
        // was never cancelled, so it stays for the retry.
        removePendingMessage(tempId);
        chatScreenApiRef.current?.putText(text);
        showComposerError("Couldn't send — check your connection and try again.");
      } else {
        resolvePendingMessage(optimisticMsg, data as MessageRow);
        // data.body is the stored ciphertext; the in-memory view keeps the
        // plaintext we already rendered (same object reference, so anything
        // holding it — quotes, reply preview — sees readable text).
        optimisticMsg.body = text;
        // The optimistic entry above used a client timestamp; now that the
        // real row is back (with its server id/created_at), refresh the
        // preview from it.
        updateChatSummaryFor(optimisticMsg);
        cancelReply();
      }
    },
    [cancelReply, hideComposerError, removePendingMessage, resolvePendingMessage, showComposerError, updateChatSummaryFor]
  );

  // ---------- Media attach ----------
  const onAttach = useCallback(
    async (file: File) => {
      const user = currentUserRef.current;
      const targetPartner = currentPartnerRef.current;
      if (!file || !targetPartner || !user) return;
      hideComposerError();

      // Everything gets compressed before upload: photos via canvas (JPEG),
      // video/audio via a WebCodecs re-encode (MP4 — see lib/media.ts).
      // Generic files are sent as-is: they're either already compressed
      // losslessly (zip/pdf) or can't be shrunk without corrupting them —
      // they only get a size cap. Media gets a bigger input cap since it's
      // compressed before the final upload cap applies.
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      const isMedia = isImage || isVideo || isAudio;
      const inputCap = isMedia ? MAX_MEDIA_INPUT_BYTES : MAX_BINARY_UPLOAD_BYTES;
      if (file.size > inputCap) {
        showComposerError(`That file is too large — the limit is ${formatBytes(inputCap)}.`);
        return;
      }

      const upload = isImage ? await compressImage(file) : isVideo || isAudio ? await compressMedia(file) : file;

      // Images are capped after compression (the 2MB post-compress limit);
      // every other kind under a bigger raw cap.
      if (isImage && upload.size > MAX_UPLOAD_BYTES) {
        showComposerError("That image is too large even after compression — please choose a smaller one.");
        return;
      }
      if (!isImage && upload.size > MAX_BINARY_UPLOAD_BYTES) {
        showComposerError(`That file is too large even after compression — the limit is ${formatBytes(MAX_BINARY_UPLOAD_BYTES)}.`);
        return;
      }

      const replyId = replyingToRef.current?.id ?? null;
      const path = `${user.id}/${Date.now()}-${upload.name}`;
      // The label is the encrypted row body: push-preview text and what
      // quotes/summaries show. Generic files carry their filename instead
      // of a kind emoji.
      const label = isImage
        ? "📷 Photo"
        : file.type.startsWith("video/")
          ? "🎬 Video"
          : file.type.startsWith("audio/")
            ? "🎵 Audio"
            : `📎 ${truncate(upload.name, 40)}`;
      const localPreviewUrl = trackBlobUrl(URL.createObjectURL(upload));
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimisticMsg: MessageView = {
        id: tempId,
        sender_id: user.id,
        recipient_id: targetPartner,
        body: null,
        media_path: path,
        media_type: upload.type,
        reply_to: replyId,
        created_at: new Date().toISOString(),
        seen_at: null,
        _pending: true,
        _localBlobUrl: localPreviewUrl,
        _fileSize: upload.size,
      };
      pendingOutgoingRef.current.push(optimisticMsg);
      messageCacheRef.current[tempId] = optimisticMsg;
      if (currentPartnerRef.current === targetPartner) {
        setMessages((prev) => [...prev, { ...optimisticMsg, _animate: true }]);
        requestAnimationFrame(() => chatScreenApiRef.current?.scrollToBottom());
      }
      updateChatSummaryFor(optimisticMsg);

      // E2EE: encrypt the attachment bytes with a one-off AES key before
      // upload — Storage only ever holds ciphertext. The key travels inside
      // the encrypted message payload below.
      let uploadData: Blob = upload;
      let mk: string | null = null;
      let mi: string | null = null;
      if (CircleCrypto.ready()) {
        const enc = await CircleCrypto.encryptFileForSend(upload);
        uploadData = enc.data;
        mk = enc.mk;
        mi = enc.mi;
      }
      const { error: uploadError } = await supabaseClient.storage.from("chat-media").upload(path, uploadData);
      if (uploadError) {
        console.error(uploadError);
        removePendingMessage(tempId);
        showComposerError("Couldn't upload the attachment — check your connection and try again.");
        return; // no message row was created, so the reply context can stay put
      }

      let rowBody: string | null = null;
      let notify: string | null = null;
      if (CircleCrypto.ready() && mk) {
        const enc = await CircleCrypto.encryptOutgoing(targetPartner, { b: null, mk, mi }, label);
        if (enc) {
          rowBody = enc.body;
          notify = enc.notify;
        }
      }

      const { data, error } = await supabaseClient
        .from("messages")
        .insert({
          sender_id: user.id,
          recipient_id: targetPartner,
          body: rowBody,
          media_path: path,
          media_type: upload.type,
          reply_to: replyId,
          ...(notify ? { notify } : {}),
        })
        .select()
        .single();
      if (error) {
        console.error(error);
        removePendingMessage(tempId);
        showComposerError("The attachment uploaded, but the message couldn't be sent. Try attaching it again.");
      } else {
        resolvePendingMessage(optimisticMsg, data as MessageRow);
        optimisticMsg.body = null;
        optimisticMsg._mk = mk;
        optimisticMsg._mi = mi;
        updateChatSummaryFor(optimisticMsg);
        if (currentPartnerRef.current === targetPartner) cancelReply();
      }
    },
    [cancelReply, hideComposerError, removePendingMessage, resolvePendingMessage, showComposerError, trackBlobUrl, updateChatSummaryFor]
  );

  // ---------- Search ----------
  const hideSearchResults = useCallback(() => {
    setSearchOpen(false);
    if (searchClearTimerRef.current) clearTimeout(searchClearTimerRef.current);
    // Content is dropped once the fade-out finishes, not immediately —
    // clearing now would collapse the box mid-animation.
    searchClearTimerRef.current = setTimeout(() => {
      setSearchResults([]);
      setSearchEmpty(null);
    }, FADE_MS);
  }, []);

  const runUserSearch = useCallback(async (term: string) => {
    const user = currentUserRef.current;
    if (!user) return;
    const seq = ++searchSeqRef.current;
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, display_name, username, public_key")
      .eq("username", term)
      .neq("id", user.id)
      .limit(10);
    if (seq !== searchSeqRef.current) return;
    if (error) return console.error(error);

    const rows = (data ?? []) as Profile[];
    for (const p of rows) {
      profileCacheRef.current = { ...profileCacheRef.current, [p.id]: p.display_name };
      if (p.username) usernameCacheRef.current = { ...usernameCacheRef.current, [p.id]: p.username };
      CircleCrypto.cachePublicKey(p.id, p.public_key);
    }
    setProfileCache(profileCacheRef.current);
    setSearchResults(rows);
    setSearchEmpty(rows.length === 0 ? `No user "@${term}" found.` : null);
    setSearchOpen(true);
  }, []);

  const onSearchTerm = useCallback(
    (value: string) => {
      setSearchTerm(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      const term = value.trim().toLowerCase();
      if (term.length < USERNAME_MIN_LENGTH) {
        searchSeqRef.current++;
        hideSearchResults();
        return;
      }
      searchDebounceRef.current = setTimeout(() => void runUserSearch(term), 250);
    },
    [hideSearchResults, runUserSearch]
  );

  // ---------- Auth ----------
  const switchToSignInMode = useCallback((opts?: { prefillUsername?: string; message?: string }) => {
    authModeRef.current = "signin";
    setAuthMode("signin");
    setPrefillUsername(opts?.prefillUsername ?? null);
    setAuthMessage(opts?.message ? { text: opts.message, ok: true } : null);
  }, []);

  const onAuthToggle = useCallback(() => {
    const next: AuthMode = authModeRef.current === "signup" ? "signin" : "signup";
    authModeRef.current = next;
    setAuthMode(next);
    setPrefillUsername(null);
    setAuthMessage(null);
  }, []);

  const handleAuthSubmit = useCallback(
    async ({ name, username, password }: { name: string; username: string; password: string }) => {
      setAuthMessage(null);
      setAuthBusy(true);
      const fakeEmail = usernameToFakeEmail(username);

      try {
        if (authModeRef.current === "signup") {
          justSignedUpRef.current = true;
          const { error } = await supabaseClient.auth.signUp({
            email: fakeEmail,
            password,
            // display_name drives what shows on message bubbles / typing
            // indicator — that should be the person's name, not their
            // (login-only) username. username is also passed through so the
            // handle_new_user() DB trigger can use it directly instead of
            // having to parse it back out of the fake email address.
            options: { data: { display_name: name, username } },
          });
          if (error) throw error;
          // The SIGNED_IN event this triggers is handled by onAuthStateChange,
          // which signs back out and shows the login form — nothing more here.
        } else {
          // Set before the call: the SIGNED_IN event (and thus enterApp) can
          // fire before signInWithPassword's promise resolves.
          pendingPasswordRef.current = password;
          const { error } = await supabaseClient.auth.signInWithPassword({ email: fakeEmail, password });
          if (error) {
            pendingPasswordRef.current = null;
            throw error;
          }
        }
      } catch (err) {
        justSignedUpRef.current = false;
        const message = (err as Error).message;
        setAuthMessage({
          text: message.includes("already registered") ? "That username is taken." : message,
          ok: false,
        });
      } finally {
        setAuthBusy(false);
      }
    },
    []
  );

  // Stop this browser from receiving pushes on logout (see lib/push.ts).
  const onSignOut = useCallback(async () => {
    await unsubscribeFromPush(currentUserRef.current?.id);
    await supabaseClient.auth.signOut();
  }, []);

  // ---------- Settings ----------
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const handleSaveSettings = useCallback(
    async (name: string): Promise<string | null> => {
      const user = currentUserRef.current;
      if (!user) return "Not signed in.";
      try {
        // Plain update, not upsert: the profiles row already exists (created
        // by the signup trigger), and the table's RLS only grants users
        // UPDATE on their own row. An upsert also checks the INSERT policy,
        // which isn't granted, so it fails with "new row violates row-level
        // security policy".
        const { data, error } = await supabaseClient
          .from("profiles")
          .update({ display_name: name })
          .eq("id", user.id)
          .select();
        if (error) throw error;
        // An update that matches no row reports no error, so check we got
        // one back — otherwise the UI would show a name the database never
        // saved.
        if (!data || data.length === 0) {
          throw new Error("Couldn't save your name. Try signing out and back in.");
        }

        // Also update the name on the auth account itself, so it matches
        // what was entered at signup and survives independently of the
        // profiles row.
        const { error: metaError } = await supabaseClient.auth.updateUser({
          data: { display_name: name },
        });
        if (metaError) throw metaError;
        // onAuthStateChange ignores this user's own USER_UPDATED event (it
        // would otherwise re-run enterApp), so refresh the in-memory copy here.
        if (currentUserRef.current?.user_metadata) currentUserRef.current.user_metadata.display_name = name;

        applyProfileCache({ ...profileCacheRef.current, [user.id]: name });
        // Re-render so the new name shows above this user's already-sent
        // messages (and in quotes/typing), keeping the current scroll
        // position.
        closeSettings();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [applyProfileCache, closeSettings]
  );

  // ---------- Conversation open/close/history ----------
  const openConversation = useCallback(
    async (partnerId: string, replace = false): Promise<void> => {
      const user = currentUserRef.current;
      if (!user) return;
      if (desktopChatCloseTimerRef.current) {
        clearTimeout(desktopChatCloseTimerRef.current);
        desktopChatCloseTimerRef.current = null;
      }
      setPlaceholderShown(false);
      setPartner(partnerId);
      setStoredOpenChat(partnerId);
      try {
        if (replace || history.state?.circleChat) {
          history.replaceState({ circleChat: partnerId }, "");
        } else {
          history.pushState({ circleChat: partnerId }, "");
        }
      } catch {}
      // The screen switch below must happen BEFORE any network awaits —
      // awaiting the partner's profile name first left the user staring at
      // the chats list for a full round trip after tapping a chat. Show "…"
      // and fill the name in when it arrives.
      setChatsShown(false);
      setChatShown(true);
      setAppHeight();
      // Desktop two-pane: reveal the right pane (until now the placeholder
      // was showing) and repaint the still-visible left pane so this
      // conversation's unread badge clears and its row gets the highlight.
      document.documentElement.classList.add("chat-open");
      // Opening the chat reads everything, so its unread badge is stale from
      // here on (markConversationSeen persists this in the database).
      const s = chatSummariesRef.current[partnerId];
      if (s) applySummaries({ ...chatSummariesRef.current, [partnerId]: { ...s, unread: 0 } });
      if (!profileCacheRef.current[partnerId]) {
        void ensureProfileCached(partnerId);
      }
      // Clear out the previous conversation's messages immediately, rather
      // than leaving them on screen until loadMessages()'s fetch resolves —
      // otherwise there's a visible flash of stale content right after the
      // screen switches.
      resetMessages();
      cancelReply();
      hideComposerError();
      setSearchTerm("");
      hideSearchResults();

      // Neither the typing channel nor the seen-marking depends on the
      // history fetch — start them first so the channel join and the seen
      // UPDATE overlap the loadMessages round trip instead of queuing behind
      // it.
      subscribeTyping();
      void markConversationSeen();
      await loadMessages();
    },
    [
      applySummaries,
      cancelReply,
      ensureProfileCached,
      hideComposerError,
      hideSearchResults,
      loadMessages,
      markConversationSeen,
      resetMessages,
      setAppHeight,
      setPartner,
      subscribeTyping,
    ]
  );

  const closeConversation = useCallback((): void => {
    conversationLoadSeqRef.current++;
    // Detach the typing broadcast for this conversation so signals from it
    // stop arriving while browsing the chats list (or after sign-out).
    if (typingChannelRef.current) {
      supabaseClient.removeChannel(typingChannelRef.current);
      typingChannelRef.current = null;
    }
    Object.keys(activeTypersRef.current).forEach(clearTyping);
    setChatShown(false);
    setPartner(null);
    clearStoredOpenChat();
    // Desktop two-pane: the conversation pane fades out in its own spot (the
    // desktop CSS keeps fading screens in flow), so .chat-open must stay
    // until that fade finishes — removing it now would display:none the pane
    // and cut the fade to a hard cut. After the fade, hand the space to the
    // placeholder and fade IT in the same way. Reopening a conversation in
    // the meantime cancels the swap (the guard below sees a partner again).
    if (isDesktopLayout()) {
      if (desktopChatCloseTimerRef.current) clearTimeout(desktopChatCloseTimerRef.current);
      desktopChatCloseTimerRef.current = setTimeout(() => {
        if (currentPartnerRef.current) return;
        document.documentElement.classList.remove("chat-open");
        setPlaceholderShown(true);
      }, FADE_MS);
    } else {
      document.documentElement.classList.remove("chat-open");
    }
  }, [clearTyping, setPartner]);

  const goBackToChats = useCallback((): void => {
    closeConversation();
    setChatsShown(true);
    setAppHeight();
    // Paint immediately from the summaries we already hold (kept up to date
    // by the realtime handlers and optimistic sends) instead of blocking on
    // a network fetch — then re-sync in the background in case anything was
    // missed, which just quietly re-renders the same list.
    void loadChatSummaries();
  }, [closeConversation, loadChatSummaries, setAppHeight]);

  // In-app back arrow: unwind the history entry so the phone's back button
  // and this arrow stay in sync (both end up on the chats-list entry).
  const onBack = useCallback(() => {
    if (history.state?.circleChat && history.length > 1) {
      history.back(); // the popstate handler below does the actual switch
    } else {
      // Hard-loaded straight into a chat with nothing to unwind: close
      // manually and clear the state so the phone's back button can't
      // re-enter a stale conversation afterwards.
      try {
        history.replaceState(null, "");
      } catch {}
      goBackToChats();
    }
  }, [goBackToChats]);

  // ---------- App entry / reset ----------
  // Tears everything user-specific down and lands back on the login form.
  // Shared by real sign-outs and by "this account was deleted server-side"
  // (handleProfileDeleted), which needs the exact same reset.
  const resetToAuthScreen = useCallback(() => {
    setUser(null);
    setPartner(null);
    CircleCrypto.clearSession();
    closeConversation();
    resetMessages();
    applySummaries({});
    // Leaving also stops broadcasting presence: removing the channel sends
    // the leave, so other users' dots go gray immediately rather than
    // waiting for the socket to time out. Clear the local set too so no dot
    // outlives it.
    if (presenceChannelRef.current) {
      supabaseClient.removeChannel(presenceChannelRef.current).catch(() => {});
      presenceChannelRef.current = null;
    }
    setOnlineUsers(new Set());
    resetPushState();
    document.documentElement.classList.remove("has-session");
    // Desktop two-pane: drop the signed-in shell so the desktop layout CSS
    // stops force-showing the chats list next to the auth screen.
    document.documentElement.classList.remove("app-visible");
    setAuthShown(true);
    setChatsShown(false);
    setChatShown(false);
    setAppHeight();
  }, [applySummaries, closeConversation, resetMessages, setAppHeight, setPartner, setUser]);

  // Someone was deleted from Supabase auth. For everyone else this removes
  // their name, chat entries and any open conversation with them on the
  // spot; for the deleted account's own tab (its JWT is still valid, so
  // realtime still delivers the event) it forces an immediate logout.
  const handleProfileDeleted = useCallback(
    async (id?: string) => {
      const user = currentUserRef.current;
      if (!id || !user) return;

      if (id === user.id) {
        // The push rows can still be removed while the orphaned session's
        // JWT is valid; then sign out — the SIGNED_OUT event runs
        // resetToAuthScreen().
        await unsubscribeFromPush(user.id);
        await supabaseClient.auth.signOut();
        // Belt: reset even if no SIGNED_OUT event came back (idempotent).
        if (currentUserRef.current) resetToAuthScreen();
        return;
      }

      clearTyping(id);
      const pc = { ...profileCacheRef.current };
      delete pc[id];
      applyProfileCache(pc);
      const uc = { ...usernameCacheRef.current };
      delete uc[id];
      usernameCacheRef.current = uc;
      const cs = { ...chatSummariesRef.current };
      delete cs[id];
      applySummaries(cs);

      if (currentPartnerRef.current === id) {
        // Standing in a conversation whose other side no longer exists —
        // kick back to the chats list (replaceState so back can't re-enter).
        try {
          history.replaceState(null, "");
        } catch {}
        goBackToChats();
      }
    },
    [applyProfileCache, applySummaries, clearTyping, goBackToChats, resetToAuthScreen]
  );

  const verifyAccountExists = useCallback(async () => {
    const user = currentUserRef.current;
    if (!user) return;
    const { data, error } = await supabaseClient.from("profiles").select("id").eq("id", user.id).maybeSingle();
    // Only a definite "no row" logs out — a network/permission error must not.
    if (!error && !data) void handleProfileDeleted(user.id);
  }, [handleProfileDeleted]);

  // ---------- Realtime channel builders ----------
  // (Declared after the handlers they call; ensureRealtime below owns them.)

  const buildMessagesChannel = useCallback((): RealtimeChannel => {
    return supabaseClient
      .channel("public:messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
        const msg = payload.new as MessageRow;
        const user = currentUserRef.current;
        // RLS means we only ever see rows we're sender or recipient of.
        if (!user || (msg.sender_id !== user.id && msg.recipient_id !== user.id)) return;
        // Encrypted rows are decrypted into a "view" before anything renders
        // or is cached (legacy plaintext rows pass through untouched).
        handleIncomingMessage(await CircleCrypto.decryptRow(msg));
      })
      // Read receipts: the recipient marking my messages seen flips my
      // single tick to a double tick in place.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as MessageRow;
        const user = currentUserRef.current;
        if (!msg.seen_at || payload.old?.seen_at || !user) return;
        if (messageCacheRef.current[msg.id]) messageCacheRef.current[msg.id].seen_at = msg.seen_at;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id)
            ? prev.map((m) => (m.id === msg.id ? { ...m, seen_at: msg.seen_at } : m))
            : prev
        );
        if (msg.sender_id === user.id) {
          const s = chatSummariesRef.current[msg.recipient_id];
          if (s && s.last && s.last.id === msg.id) {
            applySummaries({
              ...chatSummariesRef.current,
              [msg.recipient_id]: { ...s, last: { ...s.last, seen_at: msg.seen_at } },
            });
          } else {
            updateChatSummaryFor(msg);
          }
        } else if (msg.recipient_id === user.id) {
          const s = chatSummariesRef.current[msg.sender_id];
          if (s && s.unread > 0) {
            applySummaries({
              ...chatSummariesRef.current,
              [msg.sender_id]: { ...s, unread: Math.max(0, s.unread - 1) },
            });
          }
        }
      })
      // Rows deleted server-side (the admin deleted the other participant
      // and a DB trigger wiped the whole conversation): drop them from the
      // open chat in place and refresh any chat-list preview that pointed
      // at one.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        setMessages((prev) => (prev.some((m) => m.id === id) ? prev.filter((m) => m.id !== id) : prev));
        delete messageCacheRef.current[id];
        for (const partner of Object.keys(chatSummariesRef.current)) {
          if (chatSummariesRef.current[partner].last?.id === id) {
            resyncChatSummariesSoon();
            break;
          }
        }
      })
      .subscribe();
  }, [applySummaries, handleIncomingMessage, resyncChatSummariesSoon, updateChatSummaryFor]);

  // Someone renaming themselves in Settings should show up in everyone's
  // open tab immediately. The original patched DOM nodes in place to avoid
  // re-rendering; in React the profileCache state update re-renders the
  // labels/quotes/typing text/chats list naturally.
  const buildProfilesChannel = useCallback((): RealtimeChannel => {
    return supabaseClient
      .channel("public:profiles")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
        const { id, display_name, username } = payload.new as Profile;
        // Cache the username before the display-name early return below so
        // a username-only change still lands (and can't be missed).
        if (id && username) usernameCacheRef.current = { ...usernameCacheRef.current, [id]: username };
        if (!id || profileCacheRef.current[id] === display_name) return;
        applyProfileCache({ ...profileCacheRef.current, [id]: display_name });
        // A rename mid-typing should update the "… is typing" text too
        if (activeTypersRef.current[id]) {
          syncTypers({ ...activeTypersRef.current, [id]: display_name });
        }
      })
      // A profiles row vanishing means that account was deleted server-side
      // (admin action in the Supabase dashboard) — react to it live.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "profiles" }, (payload) => {
        void handleProfileDeleted(payload.old?.id);
      })
      .subscribe();
  }, [applyProfileCache, handleProfileDeleted, syncTypers]);

  // ---------- Presence (green online dot) ----------
  // Supabase Realtime presence on one shared channel: every signed-in client
  // tracks itself (keyed by user id), and each client's presence sync reports
  // exactly who else is currently connected. No database writes or schema
  // changes — and when a client's socket drops (tab closed, phone
  // suspended), Realtime removes it from the sync automatically, so "online"
  // always means "the app is actually connected right now", not "was seen
  // recently". Multiple tabs/devices of the same user collapse onto one key
  // (Phoenix presence stores an array of metas per key), and the dot stays
  // lit until the last one disconnects.
  const buildPresenceChannel = useCallback((): RealtimeChannel => {
    const user = currentUserRef.current;
    const channel = supabaseClient.channel("circle-presence", {
      config: { presence: { key: user?.id ?? "" } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineUsers(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        // Announce this client only once the subscription is actually
        // live; tracking earlier would silently do nothing.
        if (status === "SUBSCRIBED") void channel.track({ online_at: new Date().toISOString() });
      });
    return channel;
  }, []);

  // Keeps the live channels up. A websocket that silently died while the tab
  // was suspended (phones especially) sits in an errored/closed state forever
  // otherwise — push notifications keep arriving over their separate server
  // path, but the UI would stay stale until a manual refresh. A healthy
  // "joined" channel is left untouched; sign out/in within the tab reuses it
  // (supabase-js feeds the current token to the socket on every auth change).
  const ensureRealtime = useCallback(() => {
    if (channelIsDead(messagesChannelRef.current, messagesChannelSinceRef.current)) {
      supabaseClient.removeChannel(messagesChannelRef.current!).catch(() => {});
      messagesChannelRef.current = null;
    }
    if (channelIsDead(profilesChannelRef.current, profilesChannelSinceRef.current)) {
      supabaseClient.removeChannel(profilesChannelRef.current!).catch(() => {});
      profilesChannelRef.current = null;
    }
    if (channelIsDead(presenceChannelRef.current, presenceChannelSinceRef.current)) {
      supabaseClient.removeChannel(presenceChannelRef.current!).catch(() => {});
      presenceChannelRef.current = null;
    }
    if (!messagesChannelRef.current) {
      messagesChannelRef.current = buildMessagesChannel();
      messagesChannelSinceRef.current = Date.now();
    }
    if (!profilesChannelRef.current) {
      profilesChannelRef.current = buildProfilesChannel();
      profilesChannelSinceRef.current = Date.now();
    }
    if (!presenceChannelRef.current) {
      presenceChannelRef.current = buildPresenceChannel();
      presenceChannelSinceRef.current = Date.now();
    }
  }, [buildMessagesChannel, buildProfilesChannel, buildPresenceChannel]);

  function channelIsDead(channel: RealtimeChannel | null, since: number): boolean {
    if (!channel) return false;
    if (channel.state === "errored" || channel.state === "closed") return true;
    // Stuck mid-join for 10s+ (join timeout is 10s) counts as dead too, or a
    // channel that never completes its handshake would never be rebuilt.
    return channel.state !== "joined" && Date.now() - since > 10000;
  }

  const enterApp = useCallback(async () => {
    const user = currentUserRef.current;
    if (!user) return;
    // The flash-prevention "has-session"/"has-open-chat" classes (set in
    // <head>, before this real auth check ran) have CSS overrides that
    // force-show #chats-screen/#chat-screen and hide #auth-screen while the
    // React render state below is still stale. Removing them directly here
    // used to race the React commits: a paint could land after the class
    // removal but before setAuthShown(false)/setChatsShown(true) committed —
    // painting the auth screen full-bleed for a frame (the "login flash" on
    // refresh). They're removed by the layout effect keyed on headOverrides
    // below, in the same commit as the real screen state, pre-paint — no
    // frame exists between "overrides on, stale state" and "overrides off,
    // real state".
    // Desktop two-pane: marks the signed-in shell so the desktop layout CSS
    // (chats list pane + conversation pane) applies — removed again on
    // sign-out so the overrides can't leak onto the auth screen.
    document.documentElement.classList.add("app-visible");
    setAuthShown(false);
    setAppHeight();

    // Open the realtime websocket NOW, before the crypto/profile round trips
    // below: supabase-js only connects the socket lazily when the first
    // channel subscribes, which otherwise serialized the TLS+websocket
    // handshake behind setupKeys() and loadProfiles() — the first few
    // seconds after login were a dead window where incoming messages
    // couldn't reach the app at all. Connecting here overlaps the handshake
    // with that work. ensureRealtime() below remains idempotent and still
    // owns the channel lifecycle.
    supabaseClient.realtime.connect();

    // Unlock (or first-time create) this device's encryption key before any
    // message can render — the login password is only in hand on an active
    // sign-in; afterwards the key is cached locally and this is instant.
    const keysReady = await CircleCrypto.setupKeys(user.id, pendingPasswordRef.current);
    pendingPasswordRef.current = null;
    if (!keysReady) {
      console.warn(
        "Encryption key unavailable — messages will be sent unencrypted and encrypted ones can't be read until you sign out and back in."
      );
    }

    // If a conversation was still open the last time this tab loaded (e.g.
    // the user refreshed the page), reopen it instead of dropping back to
    // the chats list.
    const savedPartner = getStoredOpenChat();
    // Desktop two-pane: when a conversation is about to be reopened, reveal
    // the right pane right away instead of showing the placeholder until
    // openConversation() runs (after profiles load). No-op on mobile.
    if (savedPartner) document.documentElement.classList.add("chat-open");

    // Start realtime subscriptions and initial data fetches in parallel
    // rather than waiting on loadProfiles() before fetching
    // messages/summaries.
    ensureRealtime();
    const profilesPromise = loadProfiles();
    if (savedPartner) {
      setChatsShown(false);
      void loadChatSummaries();
      // replace=true: the refresh already reused this history entry, so
      // re-opening must not push a duplicate chat entry behind back.
      await openConversation(savedPartner, true);
    } else {
      setPartner(null);
      document.documentElement.classList.remove("chat-open");
      setChatShown(false);
      setChatsShown(true);
      void loadChatSummaries();
    }
    void profilesPromise;
    // Real screen state has just committed its setter calls: flipping
    // headOverrides in the SAME batch lets the layout effect below drop the
    // has-session/has-open-chat overrides in this commit, pre-paint.
    setHeadOverrides(false);
  }, [
    ensureRealtime,
    loadChatSummaries,
    loadProfiles,
    openConversation,
    setAppHeight,
    setPartner,
  ]);

  // Pre-paint handover of the <head> script's flash-prevention overrides.
  // Runs synchronously after the commit in which headOverrides flipped false
  // — the same commit that made authShown false and set the real screen
  // flags — so the browser never paints a frame where no override covers the
  // stale screens. Afterwards React's own .hidden/.fade-out toggling is
  // authoritative for the rest of the session, exactly as the overrides used
  // to predict ("once we're here, drop them or they outrank future toggles").
  useLayoutEffect(() => {
    if (headOverrides) return;
    const html = document.documentElement;
    html.classList.remove("has-session");
    html.classList.remove("has-open-chat");
  }, [headOverrides]);

  // ---------- Effects ----------

  // Theme is applied pre-paint by the inline <head> script (layout.tsx);
  // sync the React state with it once mounted.
  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  const onToggleTheme = useCallback(() => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next: Theme = current === "light" ? "dark" : "light";
    applyTheme(next);
    setThemeState(next);
  }, []);

  // Register the service worker once; push subscription is (re)checked on
  // every auth event, guarded inside lib/push.ts.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let disposed = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (disposed) return;
        swRegistrationRef.current = registration;
        // If a session was restored while registration was still resolving,
        // subscribe now; later sign-ins go through the auth listener below.
        const user = currentUserRef.current;
        if (user) void subscribeToPush(registration, user.id);
      })
      .catch((err) => console.error(err));
    return () => {
      disposed = true;
    };
  }, []);

  const subscribeToPushIfRegistered = useCallback((userId: string) => {
    const registration = swRegistrationRef.current;
    if (registration) void subscribeToPush(registration, userId);
  }, []);

  // ---------- Session handling ----------
  useEffect(() => {
    const { data } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // With email confirmation off, signUp() above immediately
        // establishes a session and fires this same SIGNED_IN event —
        // intercept that one case and sign back out instead of entering the
        // app, so new accounts land on the login screen instead of being
        // dropped straight into a chat.
        if (justSignedUpRef.current) {
          justSignedUpRef.current = false;
          const createdUsername = session.user.user_metadata?.username || "";
          void supabaseClient.auth.signOut().then(() => {
            switchToSignInMode({
              prefillUsername: createdUsername,
              message: "Account created — sign in to continue.",
            });
          });
          return;
        }
        // Supabase re-fires this event (e.g. TOKEN_REFRESHED) whenever the
        // tab regains focus/visibility, not just on real sign-in. Without
        // this guard, switching back to this tab after opening a media file
        // would re-run the whole enter flow and open duplicate
        // realtime/typing channels on every focus. Only run the full init
        // when this is actually a different/new session.
        if (currentUserRef.current?.id === session.user.id) {
          subscribeToPushIfRegistered(session.user.id);
          return;
        }
        setUser(session.user);
        subscribeToPushIfRegistered(session.user.id);
        void enterApp();
      } else {
        resetToAuthScreen();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [enterApp, resetToAuthScreen, setUser, subscribeToPushIfRegistered, switchToSignInMode]);

  // Phone/browser back or forward: mirror the UI to whatever entry we landed on.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (currentPartnerRef.current && !e.state?.circleChat) {
        goBackToChats();
      } else if (!currentPartnerRef.current && e.state?.circleChat) {
        void openConversation(e.state.circleChat, true);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goBackToChats, openConversation]);

  // Escape closes, in priority order: settings → search results → reply.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (settingsOpenRef.current) {
        closeSettings();
      } else if (searchOpenRef.current) {
        hideSearchResults();
      } else if (replyingToRef.current) {
        cancelReply();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cancelReply, closeSettings, hideSearchResults]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        // Messages that arrived while the tab was hidden (so weren't marked
        // seen) get read now that the user is actually looking at the chat.
        if (currentPartnerRef.current) void markConversationSeen();
        // The realtime socket may not have survived the tab being suspended:
        // rebuild dead channels and re-sync the list instead of sitting
        // stale.
        if (currentUserRef.current) {
          ensureRealtime();
          void loadChatSummaries();
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [ensureRealtime, loadChatSummaries, markConversationSeen]);

  // ---------- Periodic background sync ----------
  // Safety net under realtime, running only while the tab is visible:
  // - rebuild any dead realtime channel (ensureRealtime),
  // - re-fetch chat summaries so nothing the websocket missed stays hidden
  //   longer than one interval,
  // - re-check that this account still exists server-side, so a user
  //   deleted from Supabase auth gets logged out even if the realtime
  //   DELETE event was missed while the channel was down.
  useEffect(() => {
    const id = setInterval(() => {
      if (!currentUserRef.current || document.visibilityState !== "visible") return;
      ensureRealtime();
      void verifyAccountExists();
      void loadChatSummaries();
    }, 30000);
    return () => clearInterval(id);
  }, [ensureRealtime, loadChatSummaries, verifyAccountExists]);

  // Detach channels when the app unmounts entirely (dev HMR etc.).
  useEffect(() => {
    return () => {
      for (const ch of [
        messagesChannelRef.current,
        profilesChannelRef.current,
        presenceChannelRef.current,
        typingChannelRef.current,
      ]) {
        if (ch) supabaseClient.removeChannel(ch).catch(() => {});
      }
    };
  }, []);

  // ---------- render ----------
  const authFade = useFade(authShown);
  const chatsFade = useFade(chatsShown);
  const chatFade = useFade(chatShown);
  const placeholderFade = useFade(placeholderShown);
  const settingsFade = useFade(settingsOpen);
  const searchFadeState = useFade(searchOpen);

  return (
    <>
      <AuthScreen
        fade={authFade}
        mode={authMode}
        prefillUsername={prefillUsername}
        message={authMessage}
        busy={authBusy}
        onToggle={onAuthToggle}
        onMessage={(text, ok) => setAuthMessage({ text, ok })}
        onSubmit={handleAuthSubmit}
      />

      {/* Two-pane desktop shell: chats list on the left, conversation (or a
          placeholder) on the right. On narrow/mobile screens this wrapper is
          an inert block and each .screen still takes over the full viewport. */}
      <div className="app-layout">
        <ChatsScreen
          fade={chatsFade}
          items={chatListItems}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onSettings={openSettings}
          onSignOut={() => void onSignOut()}
          onOpenChat={(id) => void openConversation(id)}
          searchTerm={searchTerm}
          onSearchTerm={onSearchTerm}
          searchResults={searchResults}
          searchEmpty={searchEmpty}
          searchFade={searchFadeState}
          onDismissSearch={hideSearchResults}
        />

        <ChatScreen
          ref={chatScreenApiRef}
          // Identifies which conversation is open ("" when none). ChatScreen
          // keys its bottom-anchor layout effect off this so re-opening any
          // chat — even the same one — lands on the newest message.
          convoKey={currentPartner ?? ""}
          fade={chatFade}
          canSend={!!currentPartner && !!currentUser}
          partnerName={partnerName}
          partnerTip={partnerTip}
          partnerOnline={partnerOnline}
          typingText={typingText}
          rows={derivedRows}
          replyingTo={replyingTo}
          replyingName={replyingName}
          composerErrorText={composerErrorText}
          composerErrorVisible={composerErrorVisible}
          onReplyCancel={cancelReply}
          onSend={(text) => void sendMessage(text)}
          onAttach={(file) => void onAttach(file)}
          onTyping={onTyping}
          onBack={onBack}
          onOpenReply={startReply}
          onQuoteClick={(id) => void scrollToMessage(id)}
          onMediaDecrypted={trackBlobUrl}
          registerRow={registerRow}
        />

        {/* Desktop-only empty state: fills the right pane while no
            conversation is open (the conversation pane itself is
            display:none then). */}
        <div id="chat-placeholder" aria-hidden="true" className={fadeClass("", placeholderFade)}>
          <svg
            viewBox="0 0 24 24"
            width={64}
            height={64}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <ChatPlaceholderIcon />
          </svg>
          <p>Select a chat to start messaging</p>
        </div>
      </div>

      {/* Settings modal (top-level: openable from both the chats list and a
          conversation, neither of which is an ancestor of both screens) */}
      <SettingsOverlay
        fade={settingsFade}
        initialName={
          currentUser
            ? profileCache[currentUser.id] || (currentUser.user_metadata?.display_name as string | undefined) || ""
            : ""
        }
        onSave={handleSaveSettings}
        onCancel={closeSettings}
      />
    </>
  );
}
