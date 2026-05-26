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
  ]),
  {
    rules: {
      // React 19's new react-hooks/set-state-in-effect is too strict for
      // fetch-on-tab-change patterns; demote to warning.
      "react-hooks/set-state-in-effect": "warn",
      // ASCII art icons (e.g. ">_") inside JSX text get flagged as inline
      // comments; demote to warning so we can keep them.
      "react/jsx-no-comment-textnodes": "warn",
      // `_` prefix is a deliberate "unused on purpose" convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
