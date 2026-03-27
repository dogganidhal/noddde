import { toPascalCase, toCamelCase, toKebabCase } from "./naming.js";

/** Context passed to every template function. */
export interface TemplateContext {
  /** PascalCase name, e.g. "BankAccount" */
  name: string;
  /** camelCase name, e.g. "bankAccount" */
  camelName: string;
  /** kebab-case name, e.g. "bank-account" */
  kebabName: string;
}

/** Builds a TemplateContext from any casing of a raw name. */
export function buildContext(rawName: string): TemplateContext {
  return {
    name: toPascalCase(rawName),
    camelName: toCamelCase(rawName),
    kebabName: toKebabCase(rawName),
  };
}
