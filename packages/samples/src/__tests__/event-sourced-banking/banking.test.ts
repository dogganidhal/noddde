import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  testAggregate,
  testProjection,
  evolveAggregate,
  testDomain,
} from "@noddde/testing";
import { BankAccount, BankAccountState } from "../../event-sourced-banking/aggregate";
import { BankAccountProjection } from "../../event-sourced-banking/projection";
import { FixedClock } from "../../event-sourced-banking/infrastructure";
import type { BankAccountView } from "../../event-sourced-banking/queries";

// ---- Shared fixtures ----

const fixedDate = new Date("2025-01-15T10:00:00Z");
const fixedClock = new FixedClock(fixedDate);

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
};

const mockInfra = {
  clock: fixedClock,
  logger: mockLogger,
  bankAccountViewRepository: {} as any,
  transactionViewRepository: {} as any,
};

const accountCreated = {
  name: "BankAccountCreated" as const,
  payload: { id: "acc-1" },
};

const txnAuthorized = (amount: number, merchant: string) => ({
  name: "TransactionAuthorized" as const,
  payload: { id: "acc-1", timestamp: fixedDate, amount, merchant },
});

const txnDeclined = (amount: number, merchant: string) => ({
  name: "TransactionDeclined" as const,
  payload: { id: "acc-1", timestamp: fixedDate, amount, merchant },
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testAggregate
// ═══════════════════════════════════════════════════════════════════

describe("BankAccount aggregate — unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CreateBankAccount", () => {
    it("should create an account and log the creation", async () => {
      const result = await testAggregate(BankAccount)
        .when({ name: "CreateBankAccount", targetAggregateId: "acc-1" })
        .withInfrastructure(mockInfra)
        .execute();

      expect(result.events).toEqual([accountCreated]);
      expect(result.state).toEqual({
        balance: 0,
        availableBalance: 0,
        transactions: [],
      });
      expect(mockLogger.info).toHaveBeenCalledWith("Creating bank account acc-1");
    });
  });

  describe("AuthorizeTransaction", () => {
    it("should authorize when sufficient funds", async () => {
      // Start from a state with positive available balance
      const stateWithFunds: BankAccountState = {
        balance: 1000,
        availableBalance: 1000,
        transactions: [],
      };

      const result = await testAggregate(BankAccount)
        .given(accountCreated)
        .when({
          name: "AuthorizeTransaction",
          targetAggregateId: "acc-1",
          payload: { amount: 500, merchant: "Amazon" },
        })
        .withInfrastructure(mockInfra)
        .execute();

      // Starting from initialState (availableBalance: 0), any positive amount is declined.
      // Let's test with evolveAggregate from a known state instead.
      // The BankAccount domain doesn't have a "deposit" command, so we
      // test authorization directly using a pre-built state.
      const directResult = BankAccount.commands.AuthorizeTransaction(
        {
          name: "AuthorizeTransaction",
          targetAggregateId: "acc-1",
          payload: { amount: 500, merchant: "Amazon" },
        },
        stateWithFunds,
        mockInfra,
      );

      expect(directResult).toMatchObject({
        name: "TransactionAuthorized",
        payload: expect.objectContaining({
          amount: 500,
          merchant: "Amazon",
          timestamp: fixedDate,
        }),
      });
      expect(mockLogger.info).toHaveBeenCalledWith("Transaction authorized: 500 at Amazon");
    });

    it("should decline when insufficient funds", async () => {
      const result = await testAggregate(BankAccount)
        .given(accountCreated)
        .when({
          name: "AuthorizeTransaction",
          targetAggregateId: "acc-1",
          payload: { amount: 500, merchant: "Store" },
        })
        .withInfrastructure(mockInfra)
        .execute();

      expect(result.events[0]!.name).toBe("TransactionDeclined");
      expect(result.events[0]!.payload).toMatchObject({
        amount: 500,
        merchant: "Store",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Transaction declined for Store: insufficient funds",
      );
    });

    it("should track available balance reduction across multiple authorizations", async () => {
      // After creating an account (availableBalance=0), any authorization reduces it further
      const result = await testAggregate(BankAccount)
        .given(
          accountCreated,
          txnAuthorized(100, "First"),  // availableBalance: 0 - 100 = -100
        )
        .when({
          name: "AuthorizeTransaction",
          targetAggregateId: "acc-1",
          payload: { amount: 50, merchant: "Second" },
        })
        .withInfrastructure(mockInfra)
        .execute();

      // availableBalance is -100, so 50 is also declined
      expect(result.events[0]!.name).toBe("TransactionDeclined");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// evolveAggregate — state reconstruction
// ═══════════════════════════════════════════════════════════════════

describe("BankAccount — evolveAggregate", () => {
  it("should reconstruct state from event history", () => {
    const state = evolveAggregate(BankAccount, [
      accountCreated,
      txnAuthorized(500, "Salary"),
      txnAuthorized(200, "Bonus"),
      txnDeclined(2000, "Luxury Store"),
    ]);

    expect(state.balance).toBe(0);
    expect(state.availableBalance).toBe(-700); // 0 - 500 - 200
    expect(state.transactions).toHaveLength(3);
    expect(state.transactions.filter((t) => t.status === "pending")).toHaveLength(2);
    expect(state.transactions.filter((t) => t.status === "declined")).toHaveLength(1);
  });

  it("should not mutate initial state", () => {
    const before = { ...BankAccount.initialState };
    evolveAggregate(BankAccount, [accountCreated]);
    expect(BankAccount.initialState).toEqual(before);
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testProjection
// ═══════════════════════════════════════════════════════════════════

describe("BankAccountProjection — unit tests", () => {
  it("should build view from account creation and transactions", async () => {
    const result = await testProjection(BankAccountProjection)
      .given(
        { name: "BankAccountCreated", payload: { id: "acc-1" } },
        { name: "TransactionAuthorized", payload: { id: "txn-1", timestamp: fixedDate, amount: 500, merchant: "Salary" } },
        { name: "TransactionAuthorized", payload: { id: "txn-2", timestamp: fixedDate, amount: -50, merchant: "Coffee" } },
      )
      .execute();

    expect(result.view).toEqual({
      id: "acc-1",
      balance: 450,
      transactions: [
        { id: "txn-1", timestamp: fixedDate, amount: 500, status: "processed" },
        { id: "txn-2", timestamp: fixedDate, amount: -50, status: "processed" },
      ],
    });
  });

  it("should ignore declined and processed events", async () => {
    const result = await testProjection(BankAccountProjection)
      .given(
        { name: "BankAccountCreated", payload: { id: "acc-1" } },
        { name: "TransactionDeclined", payload: { id: "txn-1", timestamp: fixedDate, amount: 999, merchant: "Rejected" } },
        { name: "TransactionProcessed", payload: { id: "txn-2", timestamp: fixedDate, amount: 100, merchant: "Processed" } },
      )
      .execute();

    expect(result.view.balance).toBe(0);
    expect(result.view.transactions).toHaveLength(0);
  });

  it("should build view incrementally from existing state", async () => {
    const existingView: BankAccountView = {
      id: "acc-1",
      balance: 1000,
      transactions: [{ id: "txn-0", timestamp: fixedDate, amount: 1000, status: "processed" }],
    };

    const result = await testProjection(BankAccountProjection)
      .initialView(existingView)
      .given(
        { name: "TransactionAuthorized", payload: { id: "txn-1", timestamp: fixedDate, amount: -200, merchant: "Store" } },
      )
      .execute();

    expect(result.view.balance).toBe(800);
    expect(result.view.transactions).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — testDomain
// ═══════════════════════════════════════════════════════════════════

describe("Banking domain — slice test", () => {
  it("should run a complete banking lifecycle with projection", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { BankAccount },
      projections: { BankAccountProjection },
      infrastructure: {
        clock: fixedClock,
        logger: { info: () => {}, error: () => {}, warn: () => {} },
        bankAccountViewRepository: {} as any,
        transactionViewRepository: {} as any,
      },
    });

    // Create account
    await domain.dispatchCommand({
      name: "CreateBankAccount",
      targetAggregateId: "acc-1",
    });

    // Authorize a transaction (will be declined — no funds)
    await domain.dispatchCommand({
      name: "AuthorizeTransaction",
      targetAggregateId: "acc-1",
      payload: { amount: 100, merchant: "Amazon" },
    });

    expect(spy.publishedEvents).toHaveLength(2);
    expect(spy.publishedEvents[0]!.name).toBe("BankAccountCreated");
    expect(spy.publishedEvents[1]!.name).toBe("TransactionDeclined");

    // Projection should reflect the created account
    const view = domain.getProjectionView<BankAccountView>("BankAccountProjection");
    expect(view?.id).toBe("acc-1");
    expect(view?.balance).toBe(0);
  });
});
