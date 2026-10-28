"use client";

// Fade in / fade out — mirrors the original showEl()/hideEl() helpers.
// Toggling .hidden alone can't animate: display:none isn't transitional.
// Hiding keeps the element rendered under .fade-out (see the CSS) and swaps
// in .hidden when the transition is done; showing reveals it with .fade-out
// pre-applied, then removes it so the element transitions in from
// transparent. A per-element timer (cleared on the opposite call) keeps
// rapid show/hide/show sequences from fighting each other.

import { useEffect, useRef, useState } from "react";

export const FADE_MS = 200; // matches the 0.18s CSS transitions, plus a frame

export interface FadeState {
  hidden: boolean;
  fading: boolean;
}

export function useFade(shown: boolean): FadeState {
  const [state, setState] = useState<FadeState>({ hidden: !shown, fading: false });
  const hiddenRef = useRef(state.hidden);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  hiddenRef.current = state.hidden;

  useEffect(() => {
    if (shown) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (hiddenRef.current) {
        hiddenRef.current = false;
        setState({ hidden: false, fading: true });
        let raf2 = 0;
        const raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => setState({ hidden: false, fading: false }));
        });
        return () => {
          cancelAnimationFrame(raf1);
          cancelAnimationFrame(raf2);
        };
      }
      setState({ hidden: false, fading: false });
      return;
    }

    if (!hiddenRef.current) {
      setState((s) => ({ hidden: false, fading: true }));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        hiddenRef.current = true;
        setState({ hidden: true, fading: false });
      }, FADE_MS);
    }
  }, [shown]);

  return state;
}

// Composes the className the way the original code toggled classes by hand:
// fade-out during the transition, hidden once it's finished.
export function fadeClass(base: string, fade: FadeState): string {
  let cls = base;
  if (fade.fading && !fade.hidden) cls += " fade-out";
  if (fade.hidden) cls += " hidden";
  return cls;
}
