import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Cache Components / Partial Prefetching are disabled: they are not supported
  // by the OpenNext Cloudflare runtime (setTimeout-based scheduler stalls page
  // renders on Workers) and this app is fully client-side anyway.
};

// Wires `next dev` to the local Cloudflare bindings (wrangler platform
// proxy), so getCloudflareContext() inside /api/notify reads .dev.vars and
// behaves like production during development.
initOpenNextCloudflareForDev();

export default nextConfig;
