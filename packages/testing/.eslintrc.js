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
  overrides: [
    {
      // TODO(#140): pre-existing unused vars/args this lane's file ownership
      // doesn't cover (only domain-harness.ts does) - drop this override once
      // they're cleaned up.
      files: [
        "src/__tests__/aggregate-harness.test.ts",
        "src/__tests__/domain-harness.test.ts",
        "src/__tests__/saga-harness.test.ts",
        "src/metadata-helpers.ts",
      ],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
      },
    },
  ],
};
