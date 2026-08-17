const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["eslint:recommended", "prettier", "eslint-config-turbo"],
  plugins: ["only-warn"],
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    node: true,
  },
  settings: {
    "import/resolver": {
      typescript: {
        project,
      },
    },
  },
  ignorePatterns: [
    // Ignore dotfiles
    ".*.js",
    "node_modules/",
    "dist/",
    "tsup.config.ts",
    "coverage/",
  ],
  rules: {
    "no-console": "error",
  },
  overrides: [
    {
      files: ["*.js?(x)", "*.ts?(x)"],
    },
    {
      // Type-aware rules. Requires the extending package's own .eslintrc.js to
      // set `parserOptions.project` (all packages already do, for the
      // import/resolver above), which is why this doesn't redeclare it here.
      files: ["*.ts?(x)"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint"],
      extends: ["plugin:@typescript-eslint/recommended-type-checked"],
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          // Codebase convention: an intentionally-unused parameter is
          // prefixed with `_` (e.g. `_payload`, `_state`) rather than omitted,
          // to keep positional handler signatures self-documenting.
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-floating-promises": "error",
        // TODO(#140): recommended-type-checked's `any`/unsafe-* family and a
        // few stylistic type-checked rules fire ~3000 times across packages
        // this lane doesn't own (core/engine/adapters/samples — pre-existing
        // `any` usage the GA audit already tracks separately). Muted here so
        // enabling type-aware linting doesn't block every other lane's CI on
        // day one; each package should re-enable as it cleans up its own
        // `any` usage, then this override can shrink and eventually go away.
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/unbound-method": "off",
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/ban-types": "off",
        "@typescript-eslint/no-unnecessary-type-assertion": "off",
        "@typescript-eslint/no-redundant-type-constituents": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/await-thenable": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
      },
    },
  ],
};
