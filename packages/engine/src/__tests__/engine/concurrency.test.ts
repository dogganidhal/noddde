import { describe, it, expect } from "vitest";
import { fnv1a64, LockTimeoutError, ConcurrencyError } from "@noddde/core";

describe("fnv1a64", () => {
  it("same input produces same hash", () => {
    const a = fnv1a64("BankAccount:acc-1");
    const b = fnv1a64("BankAccount:acc-1");

    expect(a).toBe(b);
  });

  it("different inputs produce different hashes", () => {
    const a = fnv1a64("BankAccount:acc-1");
    const b = fnv1a64("BankAccount:acc-2");

    expect(a).not.toBe(b);
  });

  it("output is a bigint", () => {
    const hash = fnv1a64("Order:order-42");

    expect(typeof hash).toBe("bigint");
  });
});

describe("LockTimeoutError", () => {
  it("has correct name, message, and properties", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);

    expect(error.name).toBe("LockTimeoutError");
    expect(error.message).toContain("Account:acc-1");
    expect(error.message).toContain("5000ms");
    expect(error.aggregateName).toBe("Account");
    expect(error.aggregateId).toBe("acc-1");
    expect(error.timeoutMs).toBe(5000);
  });

  it("is an instance of Error", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);

    expect(error).toBeInstanceOf(Error);
  });

  it("is NOT an instance of ConcurrencyError", () => {
    const error = new LockTimeoutError("Account", "acc-1", 5000);

    expect(error).not.toBeInstanceOf(ConcurrencyError);
  });
});
