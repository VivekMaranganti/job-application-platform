import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `auto-job-applier-db` (packages/db) ships TS source with no build step --
  // it needs Next's own transform pipeline rather than being treated as a
  // pre-built node_modules dependency.
  transpilePackages: ["auto-job-applier-db"],
};

export default nextConfig;
