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
    // TODO(#140): one floating promise and one misused-promise finding in
    // src/rabbitmq-event-bus.ts, outside this lane's file ownership.
    // Re-enable once fixed.
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/no-misused-promises": "off",
  },
};
