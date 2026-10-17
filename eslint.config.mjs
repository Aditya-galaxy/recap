import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and local assets, never source:
    ".next-engine/**",
    "desktop/engine/**",
    "desktop/dist/**",
    "desktop/bin/**",
    "promo-assets/**",
    "mac/build/**",
  ]),
  // The desktop app's main process is plain CommonJS (Electron), so require() is how it imports.
  {
    files: ["desktop/**/*.js", "desktop/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
