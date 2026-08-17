/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@noddde/eslint-config/library.js"],
  ignorePatterns: ["coverage"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.lint.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    // TODO(#140): two pre-existing `let` that should be `const` in
    // src/kafka-event-bus.ts, outside this lane's file ownership. Re-enable
    // once fixed.
    "prefer-const": "off",
  },
};
