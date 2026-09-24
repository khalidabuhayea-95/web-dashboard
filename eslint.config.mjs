import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    // Local Python virtualenvs (gitignored) ship third-party JS that is not ours to lint.
    "ai-worker/.venv/**",
    ".venv-rembg/**",
  ]),
]);

export default eslintConfig;
