<div align="center">
  <img src=".github/logo-light.png" alt="noddde" width="300"/>

### Type-Safe Domain Modeling & Event Sourcing for TypeScript

[![CI](https://github.com/dogganidhal/noddde/actions/workflows/ci.yml/badge.svg)](https://github.com/dogganidhal/noddde/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dogganidhal/noddde/graph/badge.svg)](https://codecov.io/gh/dogganidhal/noddde)

**Domain modeling that stays out of your way. Production guarantees that protect your data.**

[Documentation](https://noddde.dev) • [Getting Started](https://noddde.dev/docs/getting-started/introduction) • [Architecture Specs](https://github.com/dogganidhal/noddde/tree/main/specs)

</div>

---

> **Status:** Pre-1.0 Release Candidate. The core API is stable. We are currently hardening distributed systems features (Outbox, Graceful Shutdown) ahead of v1.0.

Building a CQRS and Event Sourced system in TypeScript usually involves significant boilerplate. Developers often end up extending `AggregateRoot` base classes, decorating methods with `@CommandHandler()`, wiring up DI containers, and working around the type system.

**noddde starts from a different premise: an aggregate is just a value.**

Based on the functional [Decider pattern](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider), noddde relies on pure functions and type inference rather than decorators and reflection. It provides the enterprise-grade infrastructure (Transactional Outbox, Upcasters, Unit of Work) required for real-world deployments.

## Why noDDDe?

Most TypeScript frameworks force you into a corner: either drown in OOP boilerplate (classes, decorators, and DI containers) or commit your entire database to an append-only Event Store. `noddde` offers a pragmatic, functional escape hatch.

- **DDD Without the OOP Boilerplate:** Say goodbye to extending `AggregateRoot` or fighting with `@CommandHandler()` decorators. `noddde` is based entirely on the functional Decider pattern. Aggregates and Sagas are just pure functions, making your core domain incredibly easy to reason about and test.
- **Pragmatic Hybrid Persistence:** Not every entity needs a historical audit trail. `noddde` lets you mix **State-Stored** aggregates (for simple CRUD entities) and **Event-Sourced** aggregates (for high-value business logic) in the exact same domain, interacting over the same command bus.
- **The "Dual-Write" Problem, Solved:** Saving to a database and publishing an event usually leads to dropped messages if the server crashes. `noddde` solves this natively with a built-in **Transactional Outbox** and **Unit of Work**, ensuring your aggregate state and outgoing events commit in a single ACID transaction.
- **Bring Your Own ORM:** No need to migrate to a niche database. `noddde` provides production-ready adapters for the tools you already use: **Drizzle, Prisma, and TypeORM** on top of standard Postgres, MySQL, or SQLite.
- **Fearless Refactoring:** Zero runtime reflection. Because `noddde` relies entirely on strict TypeScript inference, if you change a command payload or an event schema, your IDE instantly highlights the exact projections, sagas, and tests that need updating.

## How does noddde compare to the alternatives?

The TypeScript ecosystem generally forces you to choose between heavyweight OOP frameworks (like NestJS) or committing your entire architecture to Event Sourcing. **noddde is built for the pragmatic middle ground.** Both `noddde` and excellent frameworks like `Emmett` share the exact same modern domain philosophy: **we both use pure functions and the Decider pattern** to eliminate boilerplate. The difference lies entirely in *infrastructure and persistence*.

`Emmett` is designed to be the ultimate developer experience for pure Event Sourced systems (often pairing with EventStoreDB). `noddde` is designed to bring that same elegant DX to **standard relational databases**, allowing you to choose your persistence strategy on a per-aggregate basis.

| Feature / Philosophy | NestJS CQRS | Emmett | noddde |
| :--- | :--- | :--- | :--- |
| **Primary Focus** | Full application framework modularity. | Dedicated Event Sourcing & Event-Driven systems. | **Pragmatic Hybrid DDD & CQRS.** |
| **Domain Paradigm** | Heavy OOP, Base Classes, and `@Decorators`. | Pure Functions (Decider Pattern). | **Pure Functions (Decider Pattern).** |
| **Persistence Strategy** | Typically State-Stored (via ORMs). | Event-Sourced strictly by default. | **Hybrid:** Mix State-Stored & Event-Sourced aggregates. |
| **Infrastructure Focus** | Tightly coupled to the NestJS DI container. | Native append-only Event Stores (e.g., EventStoreDB). | **Relational First:** Native Drizzle/Prisma + Transactional Outbox. |
| **Data Safety** | Left entirely to the developer. | Stream Versioning & Optimistic Concurrency. | **ACID Unit of Work, Outbox, & Pessimistic Locks.** |
| **Workflows / Sagas** | Stateful classes listening to event buses. | Process Managers reacting to streams. | **Pure functions** returning commands (executed in UoW). |

### State-Stored or Event-Sourced: You Decide

Not every aggregate requires an audit log. With `noddde`, you can mix and match. A `User` profile might just be state-stored (overwriting rows in Postgres), while a `Wallet` aggregate in the same domain uses full Event Sourcing.

```typescript
// 1. A State-Stored Aggregate (Just update the state, no events to replay)
const UserProfile = defineAggregate<UserDef>({
  // ...
});

// 2. An Event-Sourced Aggregate (Emit events, replay history)
const Wallet = defineEventSourcedAggregate<WalletDef>({
  // ...
});

// 3. Wire up the right persistence strategy for each aggregate
const db = drizzle(sqlite);
const { stateStoredPersistence, eventSourcedPersistence } =
  createDrizzlePersistence(db);

const myDomain = defineDomain({
  writeModel: {
    aggregates: { UserProfile, Wallet },
  },
});

const domain = await wireDomain(myDomain, {
  aggregates: {
    UserProfile: {
      persistence: () => stateStoredPersistence,
    },
    Wallet: {
      persistence: () => eventSourcedPersistence,
    },
  },
});
```

## The API: Pure Functions, Zero Boilerplate

An aggregate in noddde is a plain object literal defining `initialState`, `commands`, and `apply`.

```typescript
import { defineAggregate } from "@noddde/core";

const BankAccount = defineAggregate<BankAccountDef>({
  initialState: { balance: 0 },

  // Commands decide what happens (Business Logic)
  commands: {
    Deposit: (command, state) => {
      if (command.payload.amount <= 0) throw new Error("Invalid amount");
      return {
        name: "DepositMade",
        payload: { amount: command.payload.amount },
      };
    },
  },

  // Apply pure functions evolve the state (Deterministic Replay)
  apply: {
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },

  // Type-safe schema evolution for old events
  upcasters: bankAccountUpcasters,
});
```

There are no base classes to extend or lifecycle hooks to implement. The `apply` handlers are pure and synchronous, making event replay deterministic.

## Sagas: Workflows without Side Effects

Most frameworks require Sagas (Process Managers) to inject an event bus and manually dispatch commands. In noddde, Sagas are pure functions that return commands as data.

```typescript
export const OrderFulfillmentSaga = defineSaga<OrderSagaDef>({
  handlers: {
    PaymentCompleted: (event, state) => ({
      // Update saga state
      state: { ...state, status: "awaiting_shipment" },
      // Return commands to be dispatched atomically
      commands: [
        { name: "ConfirmOrder", targetAggregateId: state.orderId },
        {
          name: "ArrangeShipment",
          targetAggregateId: event.payload.shipmentId,
        },
      ],
    }),
  },
});
```

The framework wraps the state update and the resulting commands in a single Unit of Work. Testing this requires zero mocking—you simply call the function and assert the returned array.

## Testing: Given / When / Then

`@noddde/testing` provides type-safe test harnesses that express tests in the natural BDD pattern without requiring domain bootstrap or database wiring.

```typescript
import { testAggregate } from "@noddde/testing";

const result = await testAggregate(BankAccount)
  .given(
    { name: "AccountCreated", payload: { id: "acc-1" } },
    { name: "DepositMade", payload: { amount: 1000 } },
  )
  .when({
    name: "Withdraw",
    targetAggregateId: "acc-1",
    payload: { amount: 200 },
  })
  .execute();

expect(result.events[0].name).toBe("WithdrawalMade");
expect(result.state.balance).toBe(800);
```

## Getting Started

```bash
yarn add @noddde/core @noddde/engine
yarn add --dev @noddde/testing
```

Head to the [Quick Start Guide](https://noddde.dev/docs/getting-started/quick-start) to build your first domain, or explore our production-ready sample applications:

| Sample Domain                                             | Infrastructure Focus | Concepts Demonstrated                                  |
| :-------------------------------------------------------- | :------------------- | :----------------------------------------------------- |
| **[Hotel Booking](./samples/sample-hotel-booking)**       | Drizzle + SQLite     | Full-stack: 3 Aggregates, Sagas, Projections, HTTP API |
| **[Banking](./samples/sample-banking)**                   | Prisma + SQLite      | Projections, Queries, View Stores, Custom Loggers      |
| **[Flash Sale](./samples/sample-flash-sale)**             | Drizzle + Postgres   | High Contention, Optimistic Concurrency Control        |
| **[Seat Reservation](./samples/sample-seat-reservation)** | Prisma + MySQL       | Pessimistic Locking, Database Advisory Locks           |

## Contributing & Architecture

noddde is built using a strict spec-driven development pipeline. If you want to contribute, please read our [CLAUDE.md](./CLAUDE.md) and [specs/README.md](./specs/README.md) to understand how we maintain architectural rigor.

---

_License: MIT | Inspired by the [Decider pattern](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider)._
