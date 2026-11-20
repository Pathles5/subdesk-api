import js from "@eslint/js";
import globals from "globals";

// Flat ESLint config — the rules that MECHANIZE the architecture live here
// (docs/specs/02-scaffold/spec.md section 7):
//   * D-17: process.env may only be read in src/config.js (no-process-env elsewhere)
//   * D-16/D-28: serverless-http may only be imported in src/lambda.js
//   * D-16: the AWS SDK (added in phase 04) may only be imported inside src/repositories/
//   * I4: no-unused-vars, eqeqeq and strict keep the surface honest
// Tests are exempt from the layer restrictions (spec §4b/D-23: they build throwaway
// apps and import devDependencies such as supertest and js-yaml).

const LAYER_IMPORT_RESTRICTIONS = {
  paths: [
    {
      name: "serverless-http",
      message:
        "D-16/D-28: only src/lambda.js may import the Express<->Lambda adapter (serverless-http). app.js must stay runtime-agnostic.",
    },
  ],
  patterns: [
    {
      group: ["@aws-sdk/*"],
      message:
        "D-16: the AWS SDK is allowed only inside src/repositories/ (first used in phase 04). Routes, middleware and services must stay SDK-free.",
    },
  ],
};

export default [
  js.configs.recommended,
  {
    // Baseline shared by the whole repo (spec §7).
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
      // ESM modules are always strict; a "use strict" directive is an error (spec §7).
      strict: ["error", "never"],
    },
  },
  {
    files: ["src/**/*.js"],
    rules: {
      "no-process-env": "error",
      "no-restricted-imports": ["error", LAYER_IMPORT_RESTRICTIONS],
    },
  },
  {
    // D-17: src/config.js is the single reader of process.env.
    files: ["src/config.js"],
    rules: {
      "no-process-env": "off",
    },
  },
  {
    // D-28: src/lambda.js is the single importer of serverless-http. The @aws-sdk
    // restriction stays active here (repositories only, phase 04).
    files: ["src/lambda.js"],
    rules: {
      "no-restricted-imports": ["error", { patterns: LAYER_IMPORT_RESTRICTIONS.patterns }],
    },
  },
  {
    // D-16: src/repositories/ is the ONLY place the AWS SDK may be imported
    // (phase 04). The adapter restriction stays active here.
    files: ["src/repositories/**/*.js"],
    rules: {
      "no-restricted-imports": ["error", { paths: LAYER_IMPORT_RESTRICTIONS.paths }],
    },
  },
  {
    // tests/: devDependency imports are the point (supertest, js-yaml, express sub-apps).
    files: ["tests/**/*.js"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
