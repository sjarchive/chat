// Entry point — mounts the app. Ported from the vanilla app's index.html +
// Next.js page.tsx; there is no server rendering at all here, the browser
// fetches the shell and everything (auth, E2EE, realtime) happens locally.
import { createRoot } from "react-dom/client";
import ChatApp from "@/components/ChatApp";
import "./globals.css";

createRoot(document.getElementById("root")!).render(<ChatApp />);
