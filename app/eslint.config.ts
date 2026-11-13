import js from "@eslint/js";
import type { AST, Rule } from "eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// A plan's task, slice and decision numbers go stale once the plan is done, and nothing notices.
const PLAN_ID = /\b(?:interface-S\d\w*|[STD]\d{1,3}[a-z]?(?:-\d+[a-z]?)?|s\d-\d+)\b/;
const TEST_CALLS = new Set(["test", "it", "describe"]);

const noPlanIds: Rule.RuleModule = {
  meta: { type: "suggestion", schema: [], messages: { found: "\"{{id}}\" is a plan id; say what the code does instead." } },
  create: (context) => {
    const report = (loc: AST.SourceLocation | null | undefined, text: string) => {
      const id = PLAN_ID.exec(text)?.[0];
      if (id !== undefined && loc) context.report({ loc, messageId: "found", data: { id } });
    };
    const calleeName = (node: Rule.Node | { type: string }): string | undefined => {
      const callee = node as { type: string; name?: string; object?: { type: string }; callee?: { type: string } };
      if (callee.type === "Identifier") return callee.name;
      if (callee.type === "MemberExpression" && callee.object) return calleeName(callee.object);
      if (callee.type === "CallExpression" && callee.callee) return calleeName(callee.callee);
      return undefined;
    };
    return {
      Program: () => {
        for (const comment of context.sourceCode.getAllComments()) report(comment.loc, comment.value);
      },
      CallExpression: (node) => {
        const name = calleeName(node.callee);
        const [title] = node.arguments;
        if (name === undefined || !TEST_CALLS.has(name) || title === undefined) return;
        if (title.type === "Literal" && typeof title.value === "string") report(title.loc, title.value);
        if (title.type === "TemplateLiteral") report(title.loc, title.quasis.map((quasi) => quasi.value.raw).join(""));
      },
    };
  },
};

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
    plugins: { wombat: { rules: { "no-plan-ids": noPlanIds } } },
    rules: {
      // Conventions: `export const name = (…) => …` over function declarations.
      "func-style": ["error", "expression"],
      "wombat/no-plan-ids": "error",
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
