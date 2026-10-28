import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Values are public by design (project URL + anon key) — identical to what the
// original index.html hardcoded in the browser bundle. They come in as
// NEXT_PUBLIC_* build-time env vars (.env.local locally; CI env on deploy).
// Vite inlines them via `envPrefix` in vite.config.ts.
const SUPABASE_URL = import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase calls will fail."
  );
}

// Single shared client, session persisted in localStorage (same as before, so
// existing users keep their sessions and device-held encryption keys).
export const supabaseClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
