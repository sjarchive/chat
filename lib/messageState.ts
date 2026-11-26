// Pure message-list reconciliation helpers shared by ChatApp and unit tests.
// Keeping these transitions deterministic prevents duplicate bubbles, vanished
// messages when Realtime beats HTTP insert resolution, and lost in-flight
// uploads across conversation reloads.

import type { MessageRow, MessageView } from "./types";

/** Append an incoming message only if its id is not already present. */
export function upsertIncomingMessage(prev: MessageView[], msg: MessageView): MessageView[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  return [...prev, msg];
}

/**
 * Replace an optimistic bubble (identified by its original tempId) with the
 * confirmed message. Handles both race orders safely:
 * - If Realtime already inserted `resolved.id`, drop only `tempId` (when
 *   `tempId !== resolved.id`) so the real bubble is never deleted.
 * - If `tempId === resolved.id` (already resolved earlier), leave the list
 *   untouched rather than filtering out the confirmed message.
 */
export function reconcileResolvedPending(
  prev: MessageView[],
  tempId: string,
  resolved: MessageView
): MessageView[] {
  if (tempId === resolved.id) {
    return prev.map((m) => (m.id === resolved.id ? { ...resolved, _pending: false, _animate: false } : m));
  }
  const hasReal = prev.some((m) => m.id === resolved.id);
  if (hasReal) {
    return prev.some((m) => m.id === tempId) ? prev.filter((m) => m.id !== tempId) : prev;
  }
  if (!prev.some((m) => m.id === tempId)) return prev;
  return prev.map((m) => (m.id === tempId ? { ...resolved, _pending: false, _animate: false } : m));
}

/**
 * Append any still-in-flight optimistic sends for `partnerId` onto a freshly
 * loaded history slice so background syncs or conversation switches never wipe
 * an active upload/send bubble.
 */
export function mergePendingIntoHistory(
  history: MessageView[],
  pending: MessageView[],
  userId: string,
  partnerId: string
): MessageView[] {
  const existingIds = new Set(history.map((m) => m.id));
  const extra = pending.filter(
    (m) => m.sender_id === userId && m.recipient_id === partnerId && !existingIds.has(m.id)
  );
  if (extra.length === 0) return history;
  return [...history, ...extra];
}

/**
 * Returns true if the freshly fetched conversation history differs from the
 * currently rendered non-pending messages (new messages, deleted messages, or
 * updated read receipts).
 */
export function hasConversationChanged(current: MessageView[], fresh: MessageRow[]): boolean {
  const settled = current.filter((m) => !m._pending);
  if (settled.length !== fresh.length) return true;
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].id !== fresh[i].id || (settled[i].seen_at ?? null) !== (fresh[i].seen_at ?? null)) {
      return true;
    }
  }
  return false;
}
