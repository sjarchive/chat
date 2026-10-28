// Shared formatting / validation helpers — ported from the original app.

const TIME_FORMATTER = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: true });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat([], { month: "long", day: "numeric" });
const LONG_DATE_YEAR_FORMATTER = new Intl.DateTimeFormat([], { month: "long", day: "numeric", year: "numeric" });

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  // hour12 forces AM/PM everywhere — a bare toLocaleTimeString follows the
  // device's locale/clock setting, which renders 24-hour on many phones.
  if (sameDay) return TIME_FORMATTER.format(d);
  return SHORT_DATE_FORMATTER.format(d);
}

// HH:MM AM/PM in the device locale, used on every bubble's meta line.
// Reusable formatter avoids instantiating locale formatters per message row
// (up to 200x per chat open).
export function timeText(iso: string): string {
  return TIME_FORMATTER.format(new Date(iso));
}

export function dayLabel(date: string | number | Date): string {
  const now = new Date();
  const d = new Date(date);
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(d, now)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.getFullYear() !== now.getFullYear()
    ? LONG_DATE_YEAR_FORMATTER.format(d)
    : LONG_DATE_FORMATTER.format(d);
}

export function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// Kind label for a non-text message (photo/video/audio/generic file).
// Used for the chats-list preview, reply quotes, and push previews.
export function attachmentPreview(mediaType: string | null): string {
  if (mediaType?.startsWith("image/")) return "📷 Photo";
  if (mediaType?.startsWith("video/")) return "🎬 Video";
  if (mediaType?.startsWith("audio/")) return "🎵 Audio";
  return "📎 Attachment";
}

export function previewText(msg: { media_path: string | null; media_type?: string | null; body: string | null }): string {
  if (msg.media_path) return attachmentPreview(msg.media_type ?? null);
  return msg.body || "";
}

// Supabase's auth system needs an email-shaped string, but the user only
// ever sees and types a username. We turn it into a fake internal address
// behind the scenes so no real email is ever sent.
export function usernameToFakeEmail(username: string): string {
  const clean = username.trim();
  return `${clean}@users.circle-app.local`;
}

export function validateName(name: string): string | null {
  if (!name.trim()) return "Name is required.";
  if (name.length > 20) return "Name must be 20 characters or fewer.";
  return null;
}

// Same rules as the notes website
export function validateUsername(username: string): string | null {
  if (username.length < 5 || username.length > 10) {
    return "Username must be 5–10 characters.";
  }
  if (!/^[a-z0-9_.]+$/.test(username)) {
    return "Username can contain only lowercase letters, numbers, underscores, and dots.";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8 || password.length > 20) {
    return "Password must be 8–20 characters.";
  }
  if (!/[A-Z]/.test(password)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password needs a special character.";
  return null;
}

// The desktop layout (min-width: 768px) keeps the chats list visible in a
// left pane even while a conversation is open — visibility checks and
// repaints must account for it.
export function isDesktopLayout(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(min-width: 768px)").matches;
}

// Usernames are 5–10 characters (see validateUsername). Only search once a
// full username could actually have been typed — partial/mid-typing input
// shouldn't surface suggestions.
export const USERNAME_MIN_LENGTH = 5;

// ---------- Delivery ticks ----------
// WhatsApp Web's own check icons (msg-check / msg-dcheck), inlined as SVG and
// painted with currentColor. Unicode "✓" text was rendering with whatever
// font each device fell back to, so it looked different per browser/platform;
// SVG paths render pixel-identically everywhere. The double tick is the same
// path drawn twice — the right check offset down and to the right, exactly as
// WhatsApp draws it.
export const TICK_PATH =
  "M10.91 3.316l-.478-.372a.365.365 0 00-.51.063L4.566 9.879a.32.32 0 01-.484.033L1.891 7.769a.366.366 0 00-.515.006l-.423.433a.364.364 0 00.006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 00-.063-.51z";
export const TICK_SVG_SINGLE = `<svg viewBox="0 0 12 15" aria-hidden="true"><path fill="currentColor" d="${TICK_PATH}"/></svg>`;
export const TICK_SVG_DOUBLE = `<svg viewBox="0 0 17 15" aria-hidden="true"><path fill="currentColor" d="${TICK_PATH}"/><path fill="currentColor" d="${TICK_PATH}" transform="translate(5.075 2.288)"/></svg>`;
// WhatsApp's in-flight clock: outlined circle with hands, sized to sit in the
// same 15-unit-tall box as the ticks (faded via .tick.pending).
export const TICK_SVG_CLOCK = `<svg viewBox="0 0 12 15" aria-hidden="true"><circle cx="6" cy="7.5" r="4.55" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 4.9v2.6h2.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- Remember which conversation is open, across refreshes ----------
export function getStoredOpenChat(): string | null {
  try {
    return sessionStorage.getItem("circle-open-chat");
  } catch {
    return null;
  }
}

export function setStoredOpenChat(partnerId: string): void {
  try {
    sessionStorage.setItem("circle-open-chat", partnerId);
  } catch {}
}

export function clearStoredOpenChat(): void {
  try {
    sessionStorage.removeItem("circle-open-chat");
  } catch {}
}
