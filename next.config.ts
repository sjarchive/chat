import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
};

// Wires `next dev` to the local Cloudflare bindings (wrangler platform
// proxy), so getCloudflareContext() inside /api/notify reads .dev.vars and
// behaves like production during development.
initOpenNextCloudflareForDev();

export default nextConfig;
