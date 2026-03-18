/**
 * Fund Transfer Sample
 *
 * Demonstrates domain.withUnitOfWork() for atomic multi-command operations.
 * A fund transfer debits one account and credits another — both must succeed
 * or neither should take effect.
 */
import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/engine";
import type { Infrastructure } from "@noddde/core";
import { Account } from "./aggregate";

const main = async () => {
  const persistence = new InMemoryEventSourcedAggregatePersistence();

  const domain = await configureDomain<Infrastructure>({
    writeModel: { aggregates: { Account } },
    readModel: { projections: {} },
    infrastructure: {
      aggregatePersistence: () => persistence,
      cqrsInfrastructure: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    },
  });

  // --- Setup: open two accounts and fund Alice's ---

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

  console.log("=== Initial state ===");
  console.log(
    "Alice events:",
    (await persistence.load("Account", "alice")).map((e) => e.name),
  );
  console.log(
    "Bob events:",
    (await persistence.load("Account", "bob")).map((e) => e.name),
  );

  // --- Successful transfer: Alice sends 50 to Bob ---

  console.log("\n=== Transfer 50 from Alice to Bob ===");

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

  console.log(
    "Alice events:",
    (await persistence.load("Account", "alice")).map((e) => e.name),
  );
  console.log(
    "Bob events:",
    (await persistence.load("Account", "bob")).map((e) => e.name),
  );

  // --- Failed transfer: Alice tries to send 300 (insufficient funds) ---
  // The unit of work ensures neither account is modified.

  console.log("\n=== Transfer 300 from Alice to Bob (should fail) ===");

  const aliceEventsBefore = await persistence.load("Account", "alice");
  const bobEventsBefore = await persistence.load("Account", "bob");

  try {
    await domain.withUnitOfWork(async () => {
      await domain.dispatchCommand({
        name: "Withdraw",
        targetAggregateId: "alice",
        payload: { amount: 300 },
      });
      // This line is never reached — Withdraw throws
      await domain.dispatchCommand({
        name: "Deposit",
        targetAggregateId: "bob",
        payload: { amount: 300 },
      });
    });
  } catch (error: any) {
    console.log("Transfer failed:", error.message);
  }

  const aliceEventsAfter = await persistence.load("Account", "alice");
  const bobEventsAfter = await persistence.load("Account", "bob");

  console.log(
    "Alice events unchanged:",
    aliceEventsAfter.length === aliceEventsBefore.length,
  );
  console.log(
    "Bob events unchanged:",
    bobEventsAfter.length === bobEventsBefore.length,
  );
};

main();
