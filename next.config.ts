import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, only for the Docker image (plain `npm start` doesn't use it).
  output: process.env.RECAP_STANDALONE ? "standalone" : undefined,
  // DATA_DIR and the Whisper model default to folders inside the project, so the tracer would copy
  // recordings and the model into the build. They're runtime data, never code.
  outputFileTracingExcludes: { "/*": ["data/**", "models/**", "desktop/**", "mac/**"] },
  poweredByHeader: false,
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
