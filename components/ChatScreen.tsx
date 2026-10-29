// CHAT SCREEN — conversation header (back / partner name / presence dot /
// typing indicator), the E2EE notice, the message list with day dividers,
// and the composer stack (jump-to-bottom, reply preview, error banner,
// attach + text + send).
//
// Owns scroll management (near-bottom detection, jump-to-bottom button,
// image-load corrections). Message content/decryption state lives in
// ChatApp; imperative screen actions are exposed via the ChatScreenApi ref.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import MessageRow from "./MessageRow";
import { BackIcon, ICON_ATTRS, LockIcon } from "./icons";
import { fadeClass, useFade } from "@/lib/fade";
import { attachmentPreview, truncate } from "@/lib/utils";
import type { MessageView } from "@/lib/types";

export type DerivedRow =
  | { kind: "divider"; id: string; label: string }
  | {
      kind: "msg";
      msg: MessageView;
      mine: boolean;
      grouped: boolean;
      groupLast: boolean;
      animateIn: boolean;
      showName: boolean;
      senderName: string;
      quotedMsg: MessageView | null;
      quotedName: string;
    };

export interface ChatScreenApi {
  scrollToBottom(): void;
  isNearBottom(): boolean;
  /** A message arrived while the user was scrolled up. */
  bumpUnseen(): void;
  focusInput(): void;
  /** Put text back into the composer (failed send). */
  putText(text: string): void;
  /** True while the input is the focused field AND it took focus while the
   * list was near its bottom. The keyboard-opening viewport sync re-anchors
   * to the newest message only in that case — focusing the composer from
   * deep in history (to reply to an older message) must not yank the user
   * to the latest message; only sending does that (see sendMessage). */
  inputFocusedNearBottom(): boolean;
  /** Used by scrollToMessage(): center a row element in the viewport. */
  scrollRowIntoView(row: HTMLElement, behavior?: ScrollBehavior): void;
}

interface ChatScreenProps {
  /** Partner id of the open conversation, "" when none. Conversation-change
   * key for the bottom-anchor effect (see pendingAnchor below). */
  convoKey: string;
  fade: { hidden: boolean; fading: boolean };
  canSend: boolean;
  partnerName: string;
  partnerTip: string | null; // "@username" tooltip, or null to remove it
  partnerOnline: boolean;
  typingText: string | null;
  rows: DerivedRow[];
  replyingTo: MessageView | null;
  replyingName: string;
  composerErrorText: string;
  composerErrorVisible: boolean;
  onReplyCancel: () => void;
  onSend: (text: string) => void;
  onAttach: (file: File) => void;
  onTyping: (value: string) => void;
  onBack: () => void;
  onOpenReply: (msg: MessageView) => void;
  onQuoteClick: (replyToId: string) => void;
  registerRow: (id: string, el: HTMLDivElement | null) => void;
}

const ChatScreen = forwardRef<ChatScreenApi, ChatScreenProps>(function ChatScreen(
  {
    convoKey,
    fade,
    canSend,
    partnerName,
    partnerTip,
    partnerOnline,
    typingText,
    rows,
    replyingTo,
    replyingName,
    composerErrorText,
    composerErrorVisible,
    onReplyCancel,
    onSend,
    onAttach,
    onTyping,
    onBack,
    onOpenReply,
    onQuoteClick,
    registerRow,
  },
  ref
) {
  const listRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const attachRef = useRef<HTMLInputElement | null>(null);
  const [input, setInput] = useState("");
  const [unseenCount, setUnseenCount] = useState(0);
  const unseenRef = useRef(0);
  const countRef = useRef("");
  const jumpVisibleRef = useRef(false);
  const [jumpVisible, setJumpVisible] = useState(false);
  const rafBusyRef = useRef(false);

  // Set when the composer input takes focus: whether the list was near its
  // bottom at that instant. The keyboard-opening viewport sync (see ChatApp)
  // re-anchors to the newest message only when this is true, so composing a
  // reply from mid-history keeps the reading position instead of jumping to
  // the latest message — the jump is reserved for hitting Send.
  const keyboardAnchorRef = useRef(false);

  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const updateJumpBottom = useCallback(() => {
    // Shown whenever the user has scrolled up into history — not just when
    // new messages arrived while scrolled up — so it always offers a way
    // back down. The count badge only appears on top of that when there's
    // something unseen.
    const shouldShow = !isNearBottom();
    if (shouldShow !== jumpVisibleRef.current) {
      jumpVisibleRef.current = shouldShow;
      setJumpVisible(shouldShow);
    }
    if (shouldShow) {
      const count = unseenRef.current > 0 ? String(unseenRef.current) : "";
      if (countRef.current !== count) {
        countRef.current = count;
        setUnseenCount(unseenRef.current);
      }
    }
  }, [isNearBottom]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    unseenRef.current = 0;
    setUnseenCount(0);
    updateJumpBottom();
  }, [updateJumpBottom]);

  const bumpUnseen = useCallback(() => {
    unseenRef.current += 1;
    setUnseenCount(unseenRef.current);
    updateJumpBottom();
  }, [updateJumpBottom]);

  // Re-anchor the list to the newest message whenever a conversation opens.
  // The imperative scrollToBottom() from ChatApp's loadMessages() fires right
  // after renderAllMessages() queues the rows — but React commits them to the
  // DOM asynchronously, so that call measured a still-empty list (no-op), and
  // the guarded re-asserts can never recover because at scrollTop 0 the
  // freshly-tall list reports "not near bottom". This layout effect runs
  // AFTER the commit but BEFORE the paint, so the first frame of an opened
  // chat already shows the latest message, with no top-of-history flash.
  // Rows empty = history still loading: keep waiting for the render that
  // actually mounts this conversation's rows (the open path clears the list
  // first). Jump-to-bottom and the unseen counter stay in sync with what
  // scrollToBottom() would have done.
  const anchoredForRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (convoKey === anchoredForRef.current) return;
    if (rows.length === 0) return;
    anchoredForRef.current = convoKey;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    unseenRef.current = 0;
    setUnseenCount(0);
    updateJumpBottom();
  }, [convoKey, rows, updateJumpBottom]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      isNearBottom,
      bumpUnseen,
      focusInput: () => inputRef.current?.focus(),
      /** Captured on the input's focus event (keyboardAnchorRef). */
      inputFocusedNearBottom: () => keyboardAnchorRef.current,
      putText: (text: string) => setInput(text),
      scrollRowIntoView: (row: HTMLElement, behavior: ScrollBehavior = "smooth") => {
        const el = listRef.current;
        if (!el) return;
        const listRect = el.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        // Center the row in the list's visible box, clamped to what's scrollable.
        const targetTop = el.scrollTop + (rowRect.top - listRect.top) - (el.clientHeight - rowRect.height) / 2;
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTo({ top: Math.max(0, Math.min(targetTop, maxScrollTop)), behavior });
      },
    }),
    [scrollToBottom, isNearBottom, bumpUnseen]
  );

  // RAF-throttled: isNearBottom() reads scrollHeight/clientHeight, a forced
  // layout pass that's expensive in a list full of content-visibility rows.
  // Running it on every scroll event is what made scrolling stutter —
  // coalesce to one check per frame, and only touch the button's DOM when
  // its visibility or count actually changed.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafBusyRef.current) return;
      rafBusyRef.current = true;
      requestAnimationFrame(() => {
        rafBusyRef.current = false;
        if (isNearBottom() && unseenRef.current > 0) unseenRef.current = 0;
        updateJumpBottom();
      });
    };
    el.addEventListener("scroll", onScroll);

    // Opening the reply strip, showing a composer error, or the mobile
    // keyboard resizing the page all shrink the message list WITHOUT firing
    // a scroll event — leaving the button's near-bottom state stale. Re-check
    // whenever the list's box size changes (shares the scroll listener's RAF
    // throttle).
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (rafBusyRef.current) return;
        rafBusyRef.current = true;
        requestAnimationFrame(() => {
          rafBusyRef.current = false;
          updateJumpBottom();
        });
      });
      ro.observe(el);
    } else {
      window.addEventListener("resize", updateJumpBottom);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      window.removeEventListener("resize", updateJumpBottom);
    };
  }, [isNearBottom, updateJumpBottom]);

  // Keep the jump button state honest after every render (bulk loads,
  // removals, screen switches).
  useEffect(() => {
    updateJumpBottom();
  });

  const onComposerSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !canSend) return;
    setInput("");
    onSend(text);
  };

  const onAttachChange = () => {
    const el = attachRef.current;
    if (!el) return;
    const file = el.files?.[0];
    el.value = "";
    if (file) onAttach(file);
  };

  // Prevent tapping the Send button from blurring the input on mobile, so
  // the virtual keyboard stays open smoothly between consecutive messages.
  const keepKeyboard = (e: { preventDefault: () => void }) => {
    if (document.activeElement === inputRef.current) e.preventDefault();
  };

  const jumpFade = useFade(jumpVisible);
  const replyFade = useFade(!!replyingTo);
  const errFade = useFade(composerErrorVisible);
  const typingFade = useFade(!!typingText);

  // ---------- Reply strip height animation ----------
  // #reply-preview is wrapped in .reply-strip-wrap, whose height eases
  // between 0 and the strip's measured height. The open/close therefore
  // happens in ONE motion: opening grows the strip's space while it fades
  // in; closing collapses the space while it fades out — instead of the
  // old flow (strip slides down over the composer, its space then drops
  // all at once when .hidden lands), which read as two separate stages.
  const replyWrapRef = useRef<HTMLDivElement | null>(null);
  const replyStripRef = useRef<HTMLDivElement | null>(null);
  // Tracks the previous hidden state so the effect can tell an open from a
  // close. true matches useFade's initial state for !!replyingTo === false.
  const prevReplyHiddenRef = useRef(true);
  useEffect(() => {
    const wrap = replyWrapRef.current;
    const strip = replyStripRef.current;
    if (!wrap || !strip) return;
    const target = strip.offsetHeight || 0;
    const prevHidden = prevReplyHiddenRef.current;
    prevReplyHiddenRef.current = replyFade.hidden;
    const current = wrap.getBoundingClientRect().height;

    if (replyFade.hidden) {
      // Fully closed: snap to 0 with no transition (the fade already ran).
      if (current !== 0) {
        wrap.style.transition = "none";
        wrap.style.height = "0px";
      }
      return;
    }
    if (prevHidden) {
      // Opening: start collapsed with no transition, flush, then ease to the
      // measured height. Reads as the strip sliding up from under the
      // composer while it fades in.
      wrap.style.transition = "none";
      wrap.style.height = "0px";
      void wrap.offsetHeight;
      wrap.style.transition = "";
      wrap.style.height = `${target}px`;
    } else if (replyFade.fading) {
      // Closing: tween to 0 while the strip fades out — the wrapper's CSS
      // height transition does the moving, so nothing pops afterwards.
      wrap.style.height = "0px";
    }
    // Fade settled open (fading:false, not hidden): the height is already
    // pinned to the measured value; nothing to write.
  }, [replyFade]);

  // ---------- Header: tap must not select, hold must ----------
  // On mobile, a tap on the partner's name whose finger drifts a few pixels
  // (or a quick double-tap) makes the browser run its text-selection drag and
  // leave a blue ::selection box over the name. Selection there should only
  // ever come from a deliberate hold, so when the touch that just ended was
  // short, collapse whatever selection it produced.
  const nameTouchAt = useRef(0);
  const onNameTouchStart = () => {
    nameTouchAt.current = Date.now();
  };
  const onNameTouchEnd = () => {
    // Android/iOS select on holds of roughly 500ms; longer touches are left
    // alone so hold-to-select keeps working.
    if (Date.now() - nameTouchAt.current >= 400) return;
    // The highlight is painted at touch-up, after this handler runs, so
    // collapsing synchronously could miss it — wait a beat instead.
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }, 50);
  };

  const renderRow = (r: DerivedRow): ReactNode => {
    if (r.kind === "divider") {
      return (
        <div key={r.id} className="day-divider">
          {r.label}
        </div>
      );
    }
    return (
      <MessageRow
        key={r.msg.id}
        msg={r.msg}
        mine={r.mine}
        grouped={r.grouped}
        groupLast={r.groupLast}
        animateIn={r.animateIn}
        showName={r.showName}
        senderName={r.senderName}
        quotedMsg={r.quotedMsg}
        quotedName={r.quotedName}
        onOpenReply={onOpenReply}
        onQuoteClick={onQuoteClick}
        isNearBottom={isNearBottom}
        scrollToBottom={scrollToBottom}
        registerRow={registerRow}
      />
    );
  };

  return (
    <div id="chat-screen" className={fadeClass("screen", fade)}>
      <header className="chat-header">
        <button type="button" id="back-button" className="icon-button" aria-label="Back to chats" data-tip="Back to chats" onClick={onBack}>
          <svg {...ICON_ATTRS}>
            <BackIcon />
          </svg>
        </button>
        {/* data-tip lives on this wrapper, not the title span itself:
            .chat-title's overflow:hidden (name truncation) would clip the
            ::after tooltip bubble entirely — the wrapper has no clipping,
            and anchoring below it avoids covering the typing indicator. */}
        <div className="chat-header-info" data-tip={partnerTip ?? undefined}>
          <span
            className="chat-title"
            id="chat-partner-name"
            onTouchStart={onNameTouchStart}
            onTouchEnd={onNameTouchEnd}
          >
            {partnerName}
          </span>
          <span id="typing-indicator" className={fadeClass("chat-sub", typingFade)}>
            {typingText ?? ""}
          </span>
        </div>
        <PresenceDot visible={partnerOnline} />
      </header>

      <div className="encryption-notice" role="note">
        <svg
          viewBox="0 0 24 24"
          width={13}
          height={13}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <LockIcon />
        </svg>
        Messages are end-to-end encrypted
      </div>

      <main id="message-list" className="message-list" ref={listRef}>
        {rows.map(renderRow)}
      </main>

      <div className="composer-stack">
        {/* Anchored to this wrapper (see .composer-stack/.jump-bottom CSS):
            it floats directly above whichever part of the composer stack is
            currently visible — above the reply strip's ✕ when a reply is
            active, above the input bar otherwise. The reply strip and error
            banner grow the stack upward, so they can never be overlapped. */}
        <button
          type="button"
          id="jump-bottom"
          className={fadeClass("jump-bottom", jumpFade)}
          aria-label="Jump to latest messages"
          onClick={() => {
            const el = listRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            unseenRef.current = 0;
            setUnseenCount(0);
            jumpVisibleRef.current = false;
            setJumpVisible(false);
          }}
        >
          ↓ <span id="jump-bottom-count">{unseenCount > 0 ? unseenCount : ""}</span>
        </button>

        <div className="reply-strip-wrap" ref={replyWrapRef}>
          <div id="reply-preview" ref={replyStripRef} className={fadeClass("reply-preview", replyFade)}>
            <div className="reply-preview-info">
              <span id="reply-preview-name" className="reply-preview-name">
                {replyingName}
              </span>
              <span id="reply-preview-text" className="reply-preview-text">
                {replyingTo ? (replyingTo.body ? truncate(replyingTo.body, 80) : replyingTo.media_path ? attachmentPreview(replyingTo.media_type ?? null) : "") : ""}
              </span>
            </div>
            <button type="button" id="reply-preview-cancel" className="icon-button" aria-label="Cancel reply" onClick={onReplyCancel}>
              ✕
            </button>
          </div>
        </div>

        <p id="composer-error" className={fadeClass("composer-error", errFade)} role="alert">
          {composerErrorText}
        </p>

        <form id="composer" className="composer" onSubmit={onComposerSubmit}>
          <button type="button" id="attach-button" className="icon-button" aria-label="Attach media" onClick={() => attachRef.current?.click()}>
            📎
          </button>
          <input
            id="attach-input"
            type="file"
            accept="image/*,video/*,audio/*,*/*"
            className="hidden-field"
            ref={attachRef}
            onChange={onAttachChange}
          />
          <input
            id="message-input"
            type="text"
            placeholder="Message"
            autoComplete="off"
            ref={inputRef}
            value={input}
            onFocus={() => keyboardAnchorRef.current = isNearBottom()}
            onBlur={() => keyboardAnchorRef.current = false}
            onChange={(e) => {
              setInput(e.target.value);
              onTyping(e.target.value);
            }}
          />
          <button
            type="submit"
            id="send-button"
            className="send-button"
            aria-label="Send"
            onPointerDown={keepKeyboard}
            onMouseDown={keepKeyboard}
          >
            ➤
          </button>
        </form>
      </div>
    </div>
  );
});

// Mobile has no hover, so the dot's "Online" tooltip needs a touch path:
// holding the dot for ~450ms adds .tip-on (showing the ::after bubble), and
// the tooltip lingers briefly after the finger lifts so it can be read. If
// the dot sits inside a tappable row (chats list), the hold must not then
// fire the row's tap handler — hence the suppressed click.
function PresenceDot({ visible }: { visible: boolean }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressRef = useRef(false);
  const shownRef = useRef(false);

  return (
    <span
      ref={ref}
      id="partner-presence"
      className={"presence-dot tip-edge" + (visible ? "" : " hidden")}
      data-tip="Online"
      role="img"
      aria-label="Online"
      onTouchStart={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        shownRef.current = false;
        timerRef.current = setTimeout(() => {
          ref.current?.classList.add("tip-on");
          shownRef.current = true;
        }, 450);
      }}
      onTouchMove={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
      }}
      onTouchCancel={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
      }}
      onTouchEnd={() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (shownRef.current) {
          suppressRef.current = true;
          setTimeout(() => {
            ref.current?.classList.remove("tip-on");
            suppressRef.current = false;
          }, 900);
        }
      }}
      onClick={(e) => {
        if (suppressRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    />
  );
}

export default ChatScreen;
