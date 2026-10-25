import type { NextConfig } from "next";

const config: NextConfig = {
  // The landing page is a static file for now (public/landing.html). Move it into
  // app/ as React components when it starts sharing parts with the eSIM screens.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }], afterFiles: [], fallback: [] };
  },
};

export default config;
