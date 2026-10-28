import ChatApp from "@/components/ChatApp";

// The whole app is a single client-side surface (chat logic stays 100%
// client-side, as in the original vanilla app). Server-rendering only
// produces the initial static shell; all Supabase/realtime work happens
// in the browser.
export default function Page() {
  return <ChatApp />;
}
