import type { NextConfig } from "next";

const config: NextConfig = {
  // The partner API and its packages are TypeScript source in this monorepo.
  transpilePackages: ["@roam/api", "@roam/core", "@roam/db", "@roam/roambuddy"],
  // Loaded by Node at runtime rather than bundled.
  serverExternalPackages: ["fastify", "postgres"],
  // The landing page is a static file for now (public/landing.html). Move it into
  // app/ as React components when it starts sharing parts with the eSIM screens.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }], afterFiles: [], fallback: [] };
  },
};

export default config;
