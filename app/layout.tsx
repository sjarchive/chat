import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat",
  description: "One app. Everyone's in it.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Let the app decide how the layout reacts to the on-screen keyboard
  // (lib/viewport.ts reads visualViewport directly).
  interactiveWidget: "resizes-content",
  themeColor: "#0E1116",
};

// Apply the saved theme, and mark whether a session looks logged-in, before
// first paint - so there's no flash of the wrong theme or of the barebone
// auth screen. This has to run before the body's HTML is even parsed, and
// the has-session result has to be applied via CSS (not a script later in
// the page) so there's no moment where the auth screen can get painted
// un-hidden first. Real session validation still happens in ChatApp; this
// only prevents the flash while that check runs.
const PRE_PAINT_SCRIPT = `(function () {
  try {
    var t = localStorage.getItem("circle-theme") || "dark";
    document.documentElement.setAttribute("data-theme", t);
    var hasSession = Object.keys(localStorage).some(function (key) {
      return key.indexOf("sb-") === 0 && key.indexOf("-auth-token") !== -1 && localStorage.getItem(key);
    });
    if (hasSession) document.documentElement.classList.add("has-session");
    // If a conversation was open when the page was last refreshed, mark
    // that too, so the CSS below can pre-paint the chat screen straight
    // away instead of flashing the chats list first.
    if (hasSession && sessionStorage.getItem("circle-open-chat")) {
      document.documentElement.classList.add("has-open-chat");
    }
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* First element in <body>: the browser executes it before any of the
            app's HTML below is parsed, so the pre-paint classes/attributes are
            in place before the first pixel is painted. */}
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
