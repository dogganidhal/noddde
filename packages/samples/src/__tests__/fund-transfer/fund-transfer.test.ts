import { describe, expect, it } from "vitest";
import type { Infrastructure } from "@noddde/core";
import { testAggregate, evolveAggregate, testDomain } from "@noddde/testing";
import { Account } from "../../fund-transfer/aggregate";

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — testAggregate
// ═══════════════════════════════════════════════════════════════════

describe("Account aggregate — unit tests", () => {
  describe("OpenAccount", () => {
    it("should open an account with the given owner", async () => {
      const result = await testAggregate(Account)
        .when({
          name: "OpenAccount",
          targetAggregateId: "acc-1",
          payload: { owner: "Alice" },
        })
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        name: "AccountOpened",
        payload: { owner: "Alice" },
      });
      expect(result.state.owner).toBe("Alice");
    });
  });

  describe("Deposit", () => {
    it("should deposit funds", async () => {
      const result = await testAggregate(Account)
        .given({ name: "AccountOpened", payload: { owner: "Alice" } })
        .when({
          name: "Deposit",
          targetAggregateId: "acc-1",
          payload: { amount: 100 },
        })
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        name: "FundsDeposited",
        payload: { amount: 100 },
      });
      expect(result.state.balance).toBe(100);
    });
  });

  describe("Withdraw", () => {
    it("should withdraw when sufficient funds", async () => {
      const result = await testAggregate(Account)
        .given(
          { name: "AccountOpened", payload: { owner: "Alice" } },
          { name: "FundsDeposited", payload: { amount: 200 } },
        )
        .when({
          name: "Withdraw",
          targetAggregateId: "acc-1",
          payload: { amount: 50 },
        })
        .execute();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]).toEqual({
        name: "FundsWithdrawn",
        payload: { amount: 50 },
      });
      expect(result.state.balance).toBe(150);
    });

    it("should throw when insufficient funds", async () => {
      const result = await testAggregate(Account)
        .given(
          { name: "AccountOpened", payload: { owner: "Alice" } },
          { name: "FundsDeposited", payload: { amount: 50 } },
        )
        .when({
          name: "Withdraw",
          targetAggregateId: "acc-1",
          payload: { amount: 100 },
        })
        .execute();

      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("Insufficient funds");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UNIT TESTS — evolveAggregate
// ═══════════════════════════════════════════════════════════════════

describe("Account — evolveAggregate", () => {
  it("should reconstruct balance from event history", () => {
    const state = evolveAggregate(Account, [
      { name: "AccountOpened", payload: { owner: "Alice" } },
      { name: "FundsDeposited", payload: { amount: 200 } },
      { name: "FundsWithdrawn", payload: { amount: 75 } },
      { name: "FundsDeposited", payload: { amount: 50 } },
    ]);

    expect(state.owner).toBe("Alice");
    expect(state.balance).toBe(175);
  });
});

// ═══════════════════════════════════════════════════════════════════
// SLICE TEST — withUnitOfWork for atomic fund transfers
// ═══════════════════════════════════════════════════════════════════

describe("Fund transfer — withUnitOfWork", () => {
  it("should transfer funds atomically between two accounts", async () => {
    const { domain, spy } = await testDomain<Infrastructure>({
      aggregates: { Account },
    });

    // Setup: open and fund Alice, open Bob
    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "alice",
      payload: { owner: "Alice" },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "alice",
      payload: { amount: 200 },
    });
    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "bob",
      payload: { owner: "Bob" },
    });

    spy.publishedEvents.length = 0; // Reset spy

    // Transfer 50 from Alice to Bob — both in one unit of work
    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "Withdraw",
        targetAggregateId: "alice",
        payload: { amount: 50 },
      });
      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "bob",
        payload: { amount: 50 },
      });
    });

    // Both events published together after commit
    expect(spy.publishedEvents).toHaveLength(2);
    expect(spy.publishedEvents[0]!.name).toBe("FundsWithdrawn");
    expect(spy.publishedEvents[1]!.name).toBe("FundsDeposited");
  });

  it("should rollback both accounts when transfer fails", async () => {
    const { domain, spy } = await testDomain<Infrastructure>({
      aggregates: { Account },
    });

    // Setup: Alice has 100, Bob has 0
    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "alice",
      payload: { owner: "Alice" },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "alice",
      payload: { amount: 100 },
    });
    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "bob",
      payload: { owner: "Bob" },
    });

    const eventsBeforeTransfer = spy.publishedEvents.length;

    // Try to transfer 300 (Alice only has 100) — should fail
    await expect(
      domain.withUnitOfWork(async () => {
        await domain.dispatchCommand({
          name: "Withdraw",
          targetAggregateId: "alice",
          payload: { amount: 300 },
        });
        // This line is never reached
        await domain.dispatchCommand({
          name: "Deposit",
          targetAggregateId: "bob",
          payload: { amount: 300 },
        });
      }),
    ).rejects.toThrow("Insufficient funds");

    // No new events published — the unit of work rolled back
    expect(spy.publishedEvents.length).toBe(eventsBeforeTransfer);
  });

  it("should publish events only after all operations persist", async () => {
    const { domain, spy } = await testDomain<Infrastructure>({
      aggregates: { Account },
    });

    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "alice",
      payload: { owner: "Alice" },
    });
    await domain.dispatchCommand({
      name: "Deposit",
      targetAggregateId: "alice",
      payload: { amount: 500 },
    });
    await domain.dispatchCommand({
      name: "OpenAccount",
      targetAggregateId: "bob",
      payload: { owner: "Bob" },
    });

    spy.publishedEvents.length = 0;

    // Within withUnitOfWork, events are deferred until commit
    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "Withdraw",
        targetAggregateId: "alice",
        payload: { amount: 100 },
      });

      // At this point, FundsWithdrawn is deferred — not yet published
      // (We can't observe this mid-transaction, but the test below
      // verifies both events arrive together after commit)

      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "bob",
        payload: { amount: 100 },
      });
    });

    // Both events arrived together after the unit of work committed
    expect(spy.publishedEvents).toHaveLength(2);
    expect(spy.publishedEvents.map((e) => e.name)).toEqual([
      "FundsWithdrawn",
      "FundsDeposited",
    ]);
  });
});
