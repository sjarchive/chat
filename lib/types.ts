// Shared row/view types for the Supabase tables used by the chat app.

/** Raw `profiles` row (RLS: every signed-in user can read all rows). */
export interface Profile {
  id: string;
  display_name: string;
  username: string | null;
  public_key: string | null;
  enc_private_key?: string | null;
}

/** Raw `messages` row, exactly as stored in Postgres. */
export interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string | null;
  media_path: string | null;
  media_type: string | null;
  reply_to: string | null;
  created_at: string;
  seen_at: string | null;
  /** E2EE push-notification preview (encrypted to the recipient's device key). */
  notify?: string | null;
}

/**
 * A message as rendered: a raw row passed through CircleCrypto.decryptRow().
 * Plaintext/legacy rows pass through with _encrypted: false; decrypted rows
 * carry the media key/iv (`_mk`/`_mi`) that travel inside the ciphertext.
 */
export interface MessageView extends MessageRow {
  _encrypted?: boolean;
  _mk?: string | null;
  _mi?: string | null;
  /** Optimistic bubble not yet confirmed by the server. */
  _pending?: boolean;
  /** Known size in bytes of an attached file (optimistic bubble / after decrypt). */
  _fileSize?: number | null;
  /** Local object URL of an image being uploaded with this message. */
  _localBlobUrl?: string | null;
  /** Decrypted object URL, set once media decryption resolves. */
  _blobUrl?: string | null;
  /** True only for messages appended live (no entry animation on bulk loads). */
  _animate?: boolean;
}

/** One conversation's entry in the chats list. */
export interface ChatSummary {
  partner: string;
  last: MessageRow | null;
  unread: number;
  preview: string | null;
}
