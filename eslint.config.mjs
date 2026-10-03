import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-*/**", // Alternate distDirs (gitignored), e.g. local repro builds.
      "**/.data/**",
      ".vitest-tmp/**",
      "coverage/**",
      "design/**", // Imported reference artifacts, including a deliberately truncated bundle; not application source.
      "apps/events/public/mediapipe/**",
      ".pixel/**",
      "**/next-env.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    settings: { next: { rootDir: ["apps/events"] } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
