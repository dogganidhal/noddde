/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@veliche/eslint-config/library.js"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.lint.json",
  },
};
