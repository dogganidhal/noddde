<div align="center">
  <img src=".github/logo-light.png" alt="noddde" width="300"/>

### Type-Safe Domain Modeling & Event Sourcing for TypeScript

[![CI](https://github.com/dogganidhal/noddde/actions/workflows/ci.yml/badge.svg)](https://github.com/dogganidhal/noddde/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dogganidhal/noddde/graph/badge.svg)](https://codecov.io/gh/dogganidhal/noddde)

**Domain modeling that stays out of your way. Production guarantees that protect your data.**

[Documentation](https://noddde.dev) • [Getting Started](https://noddde.dev/docs/getting-started) • [Architecture Specs](https://github.com/dogganidhal/noddde/tree/main/specs)

</div>

---

> **Status:** Pre-1.0 Release Candidate. The core API is stable. We are currently hardening distributed systems features (Outbox, Graceful Shutdown) ahead of v1.0.

Building a CQRS and Event Sourced system in TypeScript usually involves significant boilerplate. Developers often end up extending `AggregateRoot` base classes, decorating methods with `@CommandHandler()`, wiring up DI containers, and working around the type system.

**noddde starts from a different premise: an aggregate is just a value.**

Based on the functional [Decider pattern](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider), noddde relies on pure functions and type inference rather than decorators and reflection. It provides the enterprise-grade infrastructure (Transactional Outbox, Upcasters, Unit of Work) required for real-world deployments.

## Why noddde?

A framework should be evaluated on its operational safety as much as its syntax. noddde is designed to handle distributed systems edge cases so your team can focus on domain logic.

- **Transactional Outbox Pattern:** Built-in at-least-once delivery. Aggregate state and outbox events commit in the same ACID transaction to prevent dropped events during node crashes.
- **Type-Safe Event Upcasting:** Evolve event schemas over time. Map historical `v1` payloads to `v2` safely during aggregate replay without resorting to `any`.
- **Concurrency Control:** Built-in Optimistic (version checking) and Pessimistic (database advisory locks) concurrency control for high-contention domains.
- **First-Class ORM Adapters:** Production-ready persistence packages for Drizzle, Prisma, and TypeORM.
- **Strict Type Inference:** No runtime reflection. If you change an event's payload, TypeScript immediately flags the projections, sagas, and tests that need updating.

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
