"use client";

// One message bubble + its reply trigger and swipe-to-reply gesture.
//
// The swipe/scroll/decrypt behaviors are ports of the original imperative
// code, kept imperative on purpose: touch dragging mutates inline styles
// through refs (no re-render per touchmove), and encrypted media resolves
// its blob URL asynchronously via local state.

import { memo, useEffect, useRef, useState, type AnimationEvent, type MouseEvent } from "react";
import { supabaseClient } from "@/lib/supabase";
import { CircleCrypto } from "@/lib/crypto";
import { formatBytes } from "@/lib/media";
import { attachmentPreview, timeText, truncate } from "@/lib/utils";
import { Tick } from "./icons";
import type { MessageView } from "@/lib/types";

export interface MessageRowProps {
  msg: MessageView;
  mine: boolean;
  grouped: boolean;
  groupLast: boolean;
  animateIn: boolean;
  showName: boolean;
  senderName: string;
  quotedMsg: MessageView | null;
  quotedName: string;
  onOpenReply: (msg: MessageView) => void;
  onQuoteClick: (replyToId: string) => void;
  onMediaDecrypted: (url: string) => void;
  isNearBottom: () => boolean;
  scrollToBottom: () => void;
  registerRow: (id: string, el: HTMLDivElement | null) => void;
}

function MessageRow({
  msg,
  mine,
  grouped,
  groupLast,
  animateIn,
  showName,
  senderName,
  quotedMsg,
  quotedName,
  onOpenReply,
  onQuoteClick,
  onMediaDecrypted,
  isNearBottom,
  scrollToBottom,
  registerRow,
}: MessageRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const replyBtnRef = useRef<HTMLButtonElement | null>(null);
  const blobUrlRef = useRef<string | null>(msg._localBlobUrl ?? null);
  const openReplyRef = useRef(onOpenReply);
  useEffect(() => {
    openReplyRef.current = onOpenReply;
  });

  const [mediaSrc, setMediaSrc] = useState<string | undefined>(undefined);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [fileSize, setFileSize] = useState<number | null>(msg._fileSize ?? null);
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [quotedBusy, setQuotedBusy] = useState(false);

  const isImage = (msg.media_type || "").startsWith("image/");
  const isVideo = (msg.media_type || "").startsWith("video/");
  const isAudio = (msg.media_type || "").startsWith("audio/");
  // image/video/audio render inline; anything else (or a media load that
  // failed) falls back to the tappable file chip.
  const playable = isImage || isVideo || isAudio;
  // The original filename is preserved in the Storage path: "…/1690…-name.ext"
  const attachmentName = (msg.media_path?.split("/").pop() ?? "").replace(/^\d+-/, "");
  const mediaUrl = msg.media_path
    ? supabaseClient.storage.from("chat-media").getPublicUrl(msg.media_path).data.publicUrl
    : null;

  // Encrypted media/attachments: fetch + decrypt asynchronously, then fill
  // in the src/href (the public URL on its own is just ciphertext). The click
  // opens the decrypted blob when we have one, the ciphertext file otherwise.
  useEffect(() => {
    if (!msg.media_path) return;
    if (msg._localBlobUrl) {
      blobUrlRef.current = msg._localBlobUrl;
      if (playable) setMediaSrc(msg._localBlobUrl);
      else setLinkHref(msg._localBlobUrl);
      return;
    }
    if (!msg._mk) {
      // Legacy unencrypted attachment
      if (playable) setMediaSrc(mediaUrl ?? undefined);
      else setLinkHref(mediaUrl);
      return;
    }
    let cancelled = false;
    CircleCrypto.decryptMedia(msg.media_path, msg._mk, msg._mi ?? "", msg.media_type).then((dec) => {
      if (cancelled || !dec) return;
      onMediaDecrypted(dec.url);
      blobUrlRef.current = dec.url;
      if (playable) setMediaSrc(dec.url);
      else {
        setFileSize(dec.size);
        setLinkHref(dec.url);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- msg fields are immutable per id
  }, [msg.id]);

  // ---------- Swipe-to-reply (mobile) ----------
  // Left-swiping a message bubble slides it left and fades in the reply
  // icon in the space that opens up; releasing past the threshold triggers
  // the reply. On desktop the icon is revealed on hover instead (see
  // .msg-row:hover in globals.css).
  //
  // Attached as native listeners because React's synthetic touchmove is
  // passive and can't preventDefault.
  useEffect(() => {
    const row = rowRef.current;
    const bubble = bubbleRef.current;
    const replyBtn = replyBtnRef.current;
    if (!row || !bubble || !replyBtn) return;

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
    const restoreTransitions = () => {
      replyBtn.style.transition =
        "width 0.18s ease, padding 0.18s ease, opacity 0.15s ease, background-color 0.3s ease, color 0.3s ease";
      bubble.style.transition = mine
        ? "background-color 0.3s ease, color 0.3s ease"
        : "transform 0.18s ease, background-color 0.3s ease, color 0.3s ease";
      if (!mine) {
        replyBtn.style.transition += ", transform 0.18s ease";
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = true;
      swiping = false;
      dragDistance = 0;
      bubble.style.transition = "none";
      replyBtn.style.transition = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
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
        // The trigger sits right after the bubble in the DOM/flex flow, so
        // its un-transformed position stays anchored where the bubble *used*
        // to be even as the bubble itself slides left. Give it the same
        // transform so it rides along with the bubble instead of just
        // widening in place.
        replyBtn.style.transform = `translateX(${-reveal}px)`;
      }
      replyBtn.style.width = reveal + "px";
      replyBtn.style.padding = (reveal * 0.15).toFixed(1) + "px"; // scales to 6px at MAX_REVEAL, same as the hover state
      replyBtn.style.opacity = Math.min(1, dragDistance / THRESHOLD).toFixed(2);
      e.preventDefault();
    };

    const endSwipe = () => {
      if (!dragging) return;
      dragging = false;
      restoreTransitions();
      replyBtn.style.width = "0px";
      replyBtn.style.padding = "0px";
      replyBtn.style.opacity = "0";
      if (!mine) {
        bubble.style.transform = "translateX(0)";
        replyBtn.style.transform = "translateX(0)";
      }
      if (swiping && dragDistance >= THRESHOLD) {
        openReplyRef.current(msg);
      }
      swiping = false;
    }

    row.addEventListener("touchstart", onTouchStart, { passive: true });
    row.addEventListener("touchmove", onTouchMove, { passive: false });
    row.addEventListener("touchend", endSwipe);
    row.addEventListener("touchcancel", endSwipe);
    return () => {
      row.removeEventListener("touchstart", onTouchStart);
      row.removeEventListener("touchmove", onTouchMove);
      row.removeEventListener("touchend", endSwipe);
      row.removeEventListener("touchcancel", endSwipe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- msg identity fixed per row
  }, [msg.id, mine]);

  const replyClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // Restart the animation even on rapid re-clicks: removing the class,
    // forcing reflow, then re-adding it makes the browser treat it as a
    // fresh animation instead of a no-op (class already present).
    const row = rowRef.current;
    if (row) {
      row.classList.remove("reply-bounce");
      void row.offsetWidth;
      row.classList.add("reply-bounce");
    }
    onOpenReply(msg);
  };

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === "reply-bounce") rowRef.current?.classList.remove("reply-bounce");
  };

  const onQuotedClick = async () => {
    if (!msg.reply_to) return;
    setQuotedBusy(true);
    try {
      onQuoteClick(msg.reply_to);
    } finally {
      setQuotedBusy(false);
    }
  };

  return (
    <div
      ref={(el) => {
        registerRow(msg.id, el);
        return () => registerRow(msg.id, null);
      }}
      className={`msg-row ${mine ? "mine" : "theirs"}${groupLast ? " group-last" : ""} ${grouped ? "grouped" : "group-start"}${animateIn ? " animate-in" : ""}`}
      data-msg-id={msg.id}
      onAnimationEnd={onAnimationEnd}
    >
      <div className="bubble" ref={bubbleRef}>
        {/* Name only on the first bubble of a consecutive run from the same
            sender — grouping makes it obvious the following ones are from
            the same person. */}
        {showName && !mine ? <span className="sender-name">{senderName}</span> : null}

        {/* Quoted preview when this message is a reply to an earlier one */}
        {msg.reply_to ? (
          <div
            className="quoted-msg"
            style={quotedBusy ? { pointerEvents: "none" } : undefined}
            onClick={() => void onQuotedClick()}
          >
            {quotedMsg ? (
              <>
                <span className="quoted-name">{quotedName}</span>
                <span className="quoted-body">
                  {quotedMsg.body ? truncate(quotedMsg.body, 80) : quotedMsg.media_path ? attachmentPreview(quotedMsg.media_type ?? null) : ""}
                </span>
              </>
            ) : (
              "Original message"
            )}
          </div>
        ) : null}

        {msg.media_path && isImage && !mediaFailed ? (
          <img
            className="media"
            alt="Photo"
            src={mediaSrc}
            // The initial auto-scroll only has a short fixed window to correct
            // for layout shifts (see loadMessages). A photo that finishes
            // loading after that window has closed grows the list and
            // permanently leaves the viewport stuck above the real bottom —
            // this event-driven correction has no time limit, so it always
            // catches up, however slow the load.
            onLoad={() => {
              if (isNearBottom()) scrollToBottom();
            }}
            onError={() => {
              setMediaFailed(true);
              if (isNearBottom()) scrollToBottom();
            }}
            onClick={() => window.open(blobUrlRef.current ?? mediaUrl ?? undefined, "_blank", "noopener,noreferrer")}
          />
        ) : null}

        {msg.media_path && isVideo && !mediaFailed ? (
          <video
            className="media"
            controls
            preload="metadata"
            src={mediaSrc}
            // Same layout-shift correction as the photo's onLoad: video
            // metadata resolving changes the bubble size after the fact.
            onLoadedMetadata={() => {
              if (isNearBottom()) scrollToBottom();
            }}
            onError={() => {
              setMediaFailed(true);
              if (isNearBottom()) scrollToBottom();
            }}
          />
        ) : null}

        {msg.media_path && isAudio && !mediaFailed ? (
          <audio
            className="media-audio"
            controls
            preload="metadata"
            src={mediaSrc}
            onLoadedMetadata={() => {
              if (isNearBottom()) scrollToBottom();
            }}
            onError={() => {
              setMediaFailed(true);
              if (isNearBottom()) scrollToBottom();
            }}
          />
        ) : null}

        {msg.media_path && (!playable || mediaFailed) ? (
          // Generic file attachments — or media that failed to load/decrypt
          // (e.g. from older clients or direct API inserts) — render as a
          // tappable file chip carrying the original filename.
          <a
            className="media-file"
            href={linkHref ?? mediaUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            download={attachmentName || undefined}
          >
            <span className="media-file-icon" aria-hidden="true">
              📎
            </span>
            <span className="media-file-name">{attachmentName || "Attachment"}</span>
            {fileSize != null ? <span className="media-file-size">{formatBytes(fileSize)}</span> : null}
          </a>
        ) : null}

        {msg.body ? <span>{msg.body}</span> : null}

        <span className="meta">
          <span>{timeText(msg.created_at)}</span>
          {mine ? (
            // Faded clock while the send is still in flight (optimistic
            // bubble), single tick once actually confirmed sent, double
            // (accent blue) once the recipient saw it.
            <Tick state={msg._pending ? "clock" : msg.seen_at ? "seen" : "sent"} />
          ) : null}
        </span>
      </div>

      {/* Icon always follows the bubble so a left-swipe drags the bubble away
          from it, not over it — avoids overlap on both mine and theirs rows. */}
      <button type="button" className="reply-trigger" aria-label="Reply to this message" ref={replyBtnRef} onClick={replyClick}>
        ↩
      </button>
    </div>
  );
}

export default memo(MessageRow);
