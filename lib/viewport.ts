"use client";

// ---------- Keep layout height accurate when the mobile keyboard opens/closes ----------
// visualViewport fires resize AND scroll in bursts while the keyboard animates.
// Applying each event immediately would write the CSS vars — and re-layout the
// page — several times per frame with values that can momentarily disagree,
// which is the one-frame jitter as the composer follows the keyboard. Coalesce
// to one update per animation frame and only touch the DOM on real changes.

import { useCallback, useEffect, useRef } from "react";

export function useViewportHeight(onComposerSync?: () => void): () => void {
  const queuedRef = useRef(false);
  const appliedHeightRef = useRef<string | null>(null);
  const appliedOffsetRef = useRef<string | null>(null);
  const lastLayoutHeightRef = useRef(0);
  const easeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    cbRef.current = onComposerSync;
  });

  const suppressTransformEase = useCallback(() => {
    document.documentElement.classList.add("kb-following-scroll");
    if (easeTimerRef.current) clearTimeout(easeTimerRef.current);
    easeTimerRef.current = setTimeout(() => {
      document.documentElement.classList.remove("kb-following-scroll");
    }, 250);
  }, []);

  const restoreTransformEase = useCallback(() => {
    if (easeTimerRef.current) clearTimeout(easeTimerRef.current);
    document.documentElement.classList.remove("kb-following-scroll");
  }, []);

  const syncViewportVars = useCallback(() => {
    queuedRef.current = false;
    const vv = window.visualViewport;
    const layoutHeight = document.documentElement.clientHeight;
    // Layout-viewport height at the previous sync. Browsers that RESIZE the
    // page for the keyboard (Android Chrome with interactive-widget=resizes-
    // content) briefly report a non-zero visual-viewport offsetTop mid-
    // animation even though the layout viewport is already the source of
    // truth — pinning the screens to that transient offset via translateY is
    // a single mid-animation jump. Only browsers that SCROLL instead (iOS
    // Safari, layout viewport unchanged) genuinely need the pinning, so
    // apply it only when the layout viewport did not just change size.
    const layoutResized = layoutHeight !== lastLayoutHeightRef.current;
    lastLayoutHeightRef.current = layoutHeight;

    const height = `${vv ? vv.height : window.innerHeight}px`;
    const offsetTop = !layoutResized && vv && vv.offsetTop ? `${vv.offsetTop}px` : "0px";

    const heightChanged = height !== appliedHeightRef.current;
    if (heightChanged) {
      // Keyboard opening or closing: the offset rides along with the height
      // change, and this is the one motion worth easing.
      appliedHeightRef.current = height;
      document.documentElement.style.setProperty("--app-height", height);
      restoreTransformEase();
      if (offsetTop !== appliedOffsetRef.current) {
        appliedOffsetRef.current = offsetTop;
        document.documentElement.style.setProperty("--app-offset-top", offsetTop);
      }
    } else if (offsetTop !== appliedOffsetRef.current) {
      // Offset moved on its own — the browser scrolled the visual viewport
      // (e.g. to reveal the newly focused field). Track it with no ease.
      // While a pure viewport scroll moves the pinning offset, the transform
      // transition on .screen would animate the change and fight the
      // browser's own movement — suppress the ease for these steps and
      // restore it once the scrolling settles.
      appliedOffsetRef.current = offsetTop;
      document.documentElement.style.setProperty("--app-offset-top", offsetTop);
      suppressTransformEase();
    }

    // Keep the composer in view when the keyboard is open
    cbRef.current?.();
  }, [restoreTransformEase, suppressTransformEase]);

  const setAppHeight = useCallback(() => {
    if (queuedRef.current) return;
    queuedRef.current = true;
    requestAnimationFrame(syncViewportVars);
  }, [syncViewportVars]);

  useEffect(() => {
    lastLayoutHeightRef.current = document.documentElement.clientHeight;
    setAppHeight();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", setAppHeight);
      vv.addEventListener("scroll", setAppHeight);
      return () => {
        vv.removeEventListener("resize", setAppHeight);
        vv.removeEventListener("scroll", setAppHeight);
      };
    }
    window.addEventListener("resize", setAppHeight);
    return () => window.removeEventListener("resize", setAppHeight);
  }, [setAppHeight]);

  return setAppHeight;
}
