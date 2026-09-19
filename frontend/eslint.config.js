import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

// Flat config for the React (JS, not TS) frontend. The plugins were already
// devDependencies; this wires them up and gives CI a lint gate.
export default [
  { ignores: ["dist", "node_modules", "build", "*.config.js"] },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      react: { version: "detect" },
      "import/resolver": {
        // The project uses Vite's @ alias for src imports
        alias: {
          map: [["@", "./src"]],
          extensions: [".js", ".jsx", ".json"],
        },
      },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off", // JS props are validated at runtime by usage; TS migration is a separate decision (spec)
      // Apostrophes are legitimate in product copy; brackets/quotes must be escaped
      "react/no-unescaped-entities": ["error", { forbid: [">", '"', "}"] }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.test.{js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
