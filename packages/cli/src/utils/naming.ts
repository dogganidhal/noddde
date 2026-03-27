/**
 * Splits any casing format into word segments.
 * Handles PascalCase, camelCase, kebab-case, snake_case, and UPPER_CASE.
 */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Converts any casing to PascalCase. */
export function toPascalCase(input: string): string {
  return splitWords(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

/** Converts any casing to camelCase. */
export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Converts any casing to kebab-case. */
export function toKebabCase(input: string): string {
  return splitWords(input)
    .map((w) => w.toLowerCase())
    .join("-");
}

/**
 * Validates that the name produces a valid TypeScript identifier.
 * Throws if the PascalCase result does not start with a letter.
 */
export function validateName(name: string): void {
  const pascal = toPascalCase(name);
  if (pascal.length === 0) {
    throw new Error(`Invalid name: "${name}" produces an empty identifier.`);
  }
  if (!/^[A-Z]/.test(pascal)) {
    throw new Error(
      `Invalid name: "${name}" must start with a letter (got "${pascal}").`,
    );
  }
}
