import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, only for the Docker image (plain `npm start` doesn't use it).
  output: process.env.RECAP_STANDALONE ? "standalone" : undefined,
  // DATA_DIR and the Whisper model default to folders inside the project, so the tracer would copy
  // recordings and the model into the build. They're runtime data, never code.
  outputFileTracingExcludes: { "/*": ["data/**", "models/**", "desktop/**", "mac/**"] },
  // Separate output folder for desktop-engine builds so they don't clobber a running dev server.
  distDir: process.env.RECAP_DIST_DIR || ".next",
  poweredByHeader: false,
  // Recap serves its own thumbnails; Next's image optimizer (and the sharp library it needs) is never used.
  images: { unoptimized: true },
  // Standard hardening for every page and API response. Nothing in Recap is meant to be embedded elsewhere, and only
  // Recap's own pages may use the camera, microphone and screen (the web recorder).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
