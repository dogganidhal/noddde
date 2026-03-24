import { describe, it, expect } from "vitest";
import { toPascalCase, toCamelCase, toKebabCase } from "../utils/naming.js";

describe("naming utils", () => {
  describe("toPascalCase", () => {
    it("converts kebab-case", () => {
      expect(toPascalCase("bank-account")).toBe("BankAccount");
    });

    it("converts camelCase", () => {
      expect(toPascalCase("bankAccount")).toBe("BankAccount");
    });

    it("preserves PascalCase", () => {
      expect(toPascalCase("BankAccount")).toBe("BankAccount");
    });

    it("converts snake_case", () => {
      expect(toPascalCase("bank_account")).toBe("BankAccount");
    });

    it("converts UPPER_CASE", () => {
      expect(toPascalCase("BANK_ACCOUNT")).toBe("BankAccount");
    });

    it("handles single word", () => {
      expect(toPascalCase("order")).toBe("Order");
    });

    it("handles multi-word", () => {
      expect(toPascalCase("order-fulfillment")).toBe("OrderFulfillment");
    });
  });

  describe("toCamelCase", () => {
    it("converts PascalCase", () => {
      expect(toCamelCase("BankAccount")).toBe("bankAccount");
    });

    it("converts kebab-case", () => {
      expect(toCamelCase("bank-account")).toBe("bankAccount");
    });

    it("handles single word", () => {
      expect(toCamelCase("Order")).toBe("order");
    });
  });

  describe("toKebabCase", () => {
    it("converts PascalCase", () => {
      expect(toKebabCase("BankAccount")).toBe("bank-account");
    });

    it("converts camelCase", () => {
      expect(toKebabCase("bankAccount")).toBe("bank-account");
    });

    it("preserves kebab-case", () => {
      expect(toKebabCase("bank-account")).toBe("bank-account");
    });

    it("converts snake_case", () => {
      expect(toKebabCase("bank_account")).toBe("bank-account");
    });

    it("handles single word", () => {
      expect(toKebabCase("Order")).toBe("order");
    });
  });
});
