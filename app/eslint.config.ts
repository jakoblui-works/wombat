import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/", "**/out/", "**/node_modules/"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Conventions: `export const name = (…) => …` over function declarations.
      "func-style": ["error", "expression"],
    },
  },
  {
    files: ["service/src/**", "service/scripts/**", "desktop/src/**"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.stories.tsx", "**/test/**", "**/e2e/**"],
    rules: {
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Over the limit; remove this override once the file is split.
    files: ["service/src/items/access.ts"],
    rules: { "max-lines": "off" },
  },
  {
    // shadcn's generated components keep their own style, so the shadcn CLI can update them.
    files: ["desktop/src/renderer/src/components/ui/**"],
    rules: { "func-style": "off" },
  },
);
