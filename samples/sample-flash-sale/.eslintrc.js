/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  extends: ["@noddde/eslint-config/library.js"],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  parserOptions: {
    project: "./tsconfig.lint.json",
    tsconfigRootDir: __dirname,
  },
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // TODO(#140): src/main-optimistic.ts and src/main-pessimistic.ts are
    // demo entrypoint scripts (console output is their whole job), outside
    // this lane's file ownership (samples/*/src is owned by Lane G).
    // Re-enable once addressed.
    "no-console": "off",
  },
};
