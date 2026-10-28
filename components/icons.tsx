// Shared inline SVGs — the same icon paths the original app used, rendered
// as React elements instead of innerHTML strings where practical. The tick
// SVGs stay as strings (they're data-driven paths reused in two places).

import { TICK_SVG_CLOCK, TICK_SVG_DOUBLE, TICK_SVG_SINGLE } from "@/lib/utils";

export function Tick({ state, className = "tick" }: { state: "clock" | "sent" | "seen"; className?: string }) {
  const svg = state === "clock" ? TICK_SVG_CLOCK : state === "seen" ? TICK_SVG_DOUBLE : TICK_SVG_SINGLE;
  const cls = className + (state === "seen" ? " seen" : state === "clock" ? " pending" : "");
  return <span className={cls} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ThemeToggleIcon({ light }: { light: boolean }) {
  // Show the icon for the theme you'd switch TO, same as the original.
  return light ? (
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  ) : (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  );
}

export function ProfileIcon() {
  return (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  );
}

export function SignOutIcon() {
  return (
    <>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </>
  );
}

export function BackIcon() {
  return <path d="M19 12H5M12 19l-7-7 7-7" />;
}

export function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ) : (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 4l16 16" />
    </>
  );
}

export function LockIcon() {
  return (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  );
}

export function ChatPlaceholderIcon() {
  return (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  );
}

export const ICON_ATTRS = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;
