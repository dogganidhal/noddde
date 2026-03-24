<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.png">
    <img alt="noddde" src=".github/logo-light.png" width="320">
  </picture>
</p>

<p align="center">
  <strong>Domain modeling for TypeScript that stays out of your way.</strong>
</p>

<p align="center">
  <a href="https://noddde.dev">Documentation</a> &bull;
  <a href="https://noddde.dev/docs/getting-started">Getting Started</a> &bull;
  <a href="https://noddde.dev/docs/patterns/order-fulfillment">Examples</a>
</p>

> **Status:** Active development, pre-1.0. The API is stabilizing but may have breaking changes. Feedback and contributions welcome.

```bash
yarn add @noddde/core @noddde/engine
yarn add --dev @noddde/testing
```

## The problem

You want to build a business application in TypeScript using DDD, CQRS, or Event Sourcing. You look at the ecosystem and find frameworks that ask you to:

- Extend `AggregateRoot` base classes
- Decorate methods with `@CommandHandler()` and `@EventHandler()`
- Wire up a dependency injection container
- Register handlers in a service bus through imperative configuration
- Fight the type system instead of leveraging it

**This is backwards.** The framework should serve the domain, not the other way around.

## The idea

So noddde starts from a different premise: **an aggregate is a value, not a class.**

noddde implements the [Decider pattern](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider). Three things define an aggregate completely:

1. **Initial state** — what it looks like before anything happens
2. **Decide** — given a command and the current state, what events should occur?
3. **Evolve** — given an event and the current state, what is the new state?

```typescript
const BankAccount = defineAggregate<BankAccountDef>({
  initialState: { balance: 0 },

  commands: {
    Deposit: (command, state) => ({
      name: "DepositMade",
      payload: { amount: command.payload.amount },
    }),
  },

  apply: {
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
  },
});
```

This is not a simplified example. This is the actual API. No base class. No decorator. No registration.

## What makes this different

### Your domain is data, not a class hierarchy

An aggregate in noddde is a plain object literal with `initialState`, `commands`, and `apply`. A projection is a plain object with `reducers` and `queryHandlers`. A saga is a plain object with `handlers` and `associations`. You can spread them, compose them, serialize them, test them with a simple function call.

There are no base classes to extend, no lifecycle hooks to implement, no abstract methods to override. If you can write a function that takes input and returns output, you can write a noddde domain.

The `apply` handlers are pure, synchronous, and have no access to infrastructure — by design. When the framework replays thousands of events to rebuild state, every replay must produce the same result. Constraining apply to pure functions makes event replay a mathematical certainty.

### The type system does the wiring

Most DDD frameworks use runtime reflection to connect commands to handlers, events to subscribers, and queries to resolvers. noddde uses TypeScript's type system instead.

You declare a type bundle — state, events, commands, infrastructure — as a single named type. From that bundle, TypeScript infers:

- What commands this aggregate can handle, and what payload each one carries
- What events each command handler is allowed to return
- What the apply handler receives, and what state it must produce
- What infrastructure is available, down to the exact method signatures

No `any`. No type assertions. No runtime validation. If it compiles, the wiring is correct.

### Infrastructure is a function parameter

Need a clock? A logger? A payment gateway? Define an interface, add it to the type bundle, and it shows up as a destructurable parameter in your command handlers:

```typescript
PlaceBid: (command, state, { clock }) => {
  if (clock.now() > state.endsAt) {
    /* reject */
  }
};
```

In production, you provide a `SystemClock`. In tests, you provide a `FixedClock`. No container. No binding syntax. No `@Inject()`. Just a function that receives what it needs.

### Sagas are return values, not side effects

A saga handler receives an event and returns `{ state, commands }`. It doesn't call `commandBus.dispatch()` — it returns the commands it wants dispatched, and the framework handles execution, ordering, and error propagation.

This means your saga handler is a pure function. You test it by calling it and asserting on the return value. No mocking. No spying on bus calls. No setting up an entire runtime just to test a workflow step.

```typescript
handlers: {
  PaymentCompleted: (event, state) => ({
    state: { ...state, status: "awaiting_shipment" },
    commands: [
      { name: "ConfirmOrder", targetAggregateId: state.orderId },
      { name: "ArrangeShipment", targetAggregateId: newShipmentId },
    ],
  }),
}
```

The same aggregate definition works with event sourcing or state snapshots — switch strategies by changing one line in your domain configuration. For production persistence, noddde provides ORM adapter packages:

```bash
yarn add @noddde/drizzle drizzle-orm   # Drizzle ORM (SQLite, PostgreSQL, MySQL)
yarn add @noddde/prisma @prisma/client  # Prisma (any Prisma-supported database)
yarn add @noddde/typeorm typeorm        # TypeORM (any TypeORM-supported database)
```

## What it includes

noddde ships with aggregates, projections, sagas, typed buses (command, query, event), two persistence strategies (event sourcing and state snapshots), unit of work for atomic transactions, and ORM adapters for [Drizzle, Prisma, and TypeORM](https://noddde.dev/docs/infrastructure/orm-adapters). In-memory implementations are included for development and testing.

## Testing

`@noddde/testing` provides type-safe test harnesses that express tests in the natural Given-When-Then pattern of the Decider — no domain bootstrap, no bus wiring, no manual spying.

**Unit test an aggregate** — given prior events, when a command arrives, assert on produced events and state:

```typescript
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

**Unit test a saga** — given prior state, when an event arrives, assert on new state and dispatched commands:

```typescript
const result = await testSaga(OrderFulfillmentSaga)
  .givenState({ status: "awaiting_payment", orderId: "o-1" })
  .when({
    name: "PaymentCompleted",
    payload: { referenceId: "o-1", amount: 99.99 },
  })
  .execute();

expect(result.state.status).toBe("awaiting_shipment");
expect(result.commands).toHaveLength(2); // ConfirmOrder + ArrangeShipment
```

**Slice test a domain** — zero-boilerplate domain with event and command spies:

```typescript
const { domain, spy } = await testDomain({
  aggregates: { BankAccount },
  projections: { BankAccountView },
  sagas: { OrderFulfillment },
});

await domain.dispatchCommand(depositCommand);

expect(spy.publishedEvents).toContainEqual({
  name: "DepositMade",
  payload: { amount: 500 },
});
expect(await bankAccountViewStore.load("acc-1")).toEqual({ balance: 500 });
```

The full toolkit includes `testAggregate`, `testProjection`, `testSaga`, `testDomain`, and `evolveAggregate`. See the [testing documentation](https://noddde.dev/docs/testing/overview) for the complete guide.

## Getting started

```bash
yarn add @noddde/core @noddde/engine
yarn add --dev @noddde/testing
```

Head to the [documentation](https://noddde.dev/docs/getting-started) for a walkthrough that builds a complete domain from scratch, or explore the [sample domains](samples/) for real-world patterns:

| Sample                                              | Persistence        | What it shows                                                                             |
| --------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| [Auction](samples/sample-auction)                   | Drizzle + SQLite   | Single aggregate baseline, rejection events, time-based business rules                    |
| [Banking](samples/sample-banking)                   | Prisma + SQLite    | Projections, queries, view stores, logger infrastructure                                  |
| [Flash Sale](samples/sample-flash-sale)             | Drizzle + Postgres | Optimistic concurrency control under contention (8 concurrent buyers)                     |
| [Seat Reservation](samples/sample-seat-reservation) | Prisma + MySQL     | Pessimistic locking with advisory locks                                                   |
| [Hotel Booking](samples/sample-hotel-booking)       | Drizzle + SQLite   | Full-stack: 3 aggregates, 3 sagas, 3 projections, Fastify HTTP, per-aggregate persistence |

```bash
# Try it now — the hotel booking sample exercises >90% of framework features
cd samples/sample-hotel-booking && yarn install && yarn test
```

## License

MIT

<p align="center">
  <sub>Built with TypeScript. Inspired by the <a href="https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider">Decider pattern</a>.</sub>
</p>
