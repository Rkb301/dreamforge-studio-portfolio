import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "eslint.config.js",
      "js/app.js",
      "js/world-engine.js",
      "backups/**",
      "scripts/extract-engine.cjs",
      "docs/provenance/source-specifications/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["js/**/*.js", "tests/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(
        [
          "window",
          "document",
          "self",
          "location",
          "localStorage",
          "indexedDB",
          "crypto",
          "console",
          "setTimeout",
          "clearTimeout",
          "structuredClone",
          "URL",
          "Blob",
          "FormData",
          "Worker",
          "MouseEvent",
          "fetch",
          "AbortSignal",
          "AbortController",
          "innerWidth",
          "getComputedStyle",
          "Buffer",
          "process",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
);
