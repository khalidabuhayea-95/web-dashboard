import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// Section boundaries (see src/lib/surfaces.js and docs/architecture.md). The project is one build
// with three sections — website, dashboard, api — that share src/lib. These rules keep a section
// from reaching into another one, so any section can later move to its own app without untangling.
const section = (files, patterns) => ({
  files,
  rules: { "no-restricted-imports": ["error", { patterns }] },
});
const forbid = (group, message) => ({ group, message });

const eslintConfig = defineConfig([
  ...nextVitals,
  section(["src/app/(website)/**"], [
    forbid(["@/app/(dashboard)/**", "@/app/api/**"], "The website must not import dashboard or API route code — share it through src/lib."),
    forbid(["@/components/editor/**", "@/store/**"], "The website must not pull in the dashboard editor."),
  ]),
  section(["src/app/(dashboard)/**"], [
    forbid(["@/app/(website)/**", "@/app/api/**"], "The dashboard must not import website or API route code — share it through src/lib."),
  ]),
  section(["src/app/api/**"], [
    forbid(["@/app/(dashboard)/**", "@/app/(website)/**"], "API routes must not import page code — share it through src/lib."),
    forbid(["@/components/**", "@/store/**"], "API routes are server-only: no UI components or client stores."),
  ]),
  section(["src/components/**", "src/store/**", "src/lib/**"], [
    forbid(["@/app/**"], "Shared code must not depend on a section in src/app."),
  ]),
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
