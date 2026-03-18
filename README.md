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

---

## The problem

You want to build a business application in TypeScript using DDD, CQRS, or Event Sourcing. You look at the ecosystem and find frameworks that ask you to:

- Extend `AggregateRoot` base classes
- Decorate methods with `@CommandHandler()` and `@EventHandler()`
- Wire up a dependency injection container
- Register handlers in a service bus through imperative configuration
- Fight the type system instead of leveraging it

Your domain logic — the most important code in your application — ends up buried under framework ceremony. The aggregate becomes a class that inherits behaviors you didn't ask for. The command handler is a method that only works because a decorator registered it at runtime. The tests require mocking a DI container before you can assert anything about business rules.

**This is backwards.** The framework should serve the domain, not the other way around.

## The idea

noddde implements the [Decider pattern](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider). An aggregate is not a class — it's a value. Three things define it completely:

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

This is not a simplified example. This is the actual API. No base class. No decorator. No registration. The object you write _is_ the aggregate — `defineAggregate` is an identity function that exists only so TypeScript can infer the types.

## What makes this different

### Your domain is data, not a class hierarchy

An aggregate in noddde is a plain object literal with `initialState`, `commands`, and `apply`. A projection is a plain object with `reducers` and `queryHandlers`. A saga is a plain object with `handlers` and `associations`. You can spread them, compose them, serialize them, test them with a simple function call.

There are no base classes to extend, no lifecycle hooks to implement, no abstract methods to override. If you can write a function that takes input and returns output, you can write a noddde domain.

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

### Apply handlers are pure — on purpose

The `apply` function takes an event payload and the current state, and returns the new state. It is pure, synchronous, and has no access to infrastructure. This isn't a limitation — it's the core guarantee that makes event sourcing safe.

When the framework replays 10,000 events to rebuild an aggregate's state, every replay must produce the same result. If apply handlers could make API calls or read from a database, replay would be non-deterministic. By constraining apply to pure functions, noddde makes event replay a mathematical certainty.

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

### Persistence is a configuration choice, not an architecture decision

noddde supports event sourcing and state snapshots through the same aggregate definition. The `commands` and `apply` functions are identical — what changes is how the framework stores and hydrates state.

Switch from event sourcing to state snapshots by changing one line in your domain configuration. Your domain code doesn't know and doesn't care.

For production, noddde provides ORM adapter packages that plug into your existing database setup:

```bash
yarn add @noddde/drizzle drizzle-orm   # Drizzle ORM (SQLite, PostgreSQL, MySQL)
yarn add @noddde/prisma @prisma/client  # Prisma (any Prisma-supported database)
yarn add @noddde/typeorm typeorm        # TypeORM (any TypeORM-supported database)
```

Each adapter provides all persistence implementations and a database-backed Unit of Work through a single factory function — no custom code required.

## What it includes

The framework ships with everything you need to build, test, and deploy a domain:

- **Aggregates** with the Decider pattern (decide + evolve)
- **Projections** that fold events into read models with typed query handlers
- **Sagas** for cross-aggregate workflow orchestration with typed event correlation
- **Command Bus, Query Bus, Event Bus** — in-memory implementations included, interfaces for your own
- **Two persistence strategies** — event sourcing and state snapshots, swappable at configuration time
- **Unit of Work** — atomic multi-command transactions with deferred event publishing
- **ORM adapters** — production-ready persistence for [Drizzle](https://noddde.dev/docs/infrastructure/orm-adapters), [Prisma](https://noddde.dev/docs/infrastructure/orm-adapters), and [TypeORM](https://noddde.dev/docs/infrastructure/orm-adapters) with real database transactions
- **`configureDomain`** — a single function that wires write model, read model, process model, and infrastructure into a running system

The in-memory implementations are designed for development and testing. For production persistence, use one of the ORM adapter packages (`@noddde/drizzle`, `@noddde/prisma`, `@noddde/typeorm`) or implement the interfaces with your own storage backend.

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
expect(domain.getProjectionView("BankAccountView")).toEqual({ balance: 500 });
```

The full toolkit includes `testAggregate`, `testProjection`, `testSaga`, `testDomain`, and `evolveAggregate`. See the [testing documentation](https://noddde.dev/docs/testing/overview) for the complete guide.

## Getting started

```bash
yarn add @noddde/core @noddde/engine
yarn add --dev @noddde/testing
```

Head to the [documentation](https://noddde.dev/docs/getting-started) for a walkthrough that builds a complete domain from scratch, or explore the [sample domains](samples/) for real-world patterns:

| Sample                                     | Persistence      | What it shows                                                     |
| ------------------------------------------ | ---------------- | ----------------------------------------------------------------- |
| [Auction](samples/sample-auction)          | Drizzle + SQLite | Commands, events, business rules, infrastructure injection        |
| [Banking](samples/sample-banking)          | Prisma + SQLite  | Event sourcing, projections, queries, repositories                |
| [Order Fulfillment](samples/sample-orders) | TypeORM + SQLite | 3 aggregates, saga orchestration, cross-context event correlation |
| [Fund Transfer](samples/sample-transfers)  | In-memory        | Atomic multi-command transactions with `withUnitOfWork()`         |

## License

MIT

---

<p align="center">
  <sub>Built with TypeScript. Inspired by the <a href="https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider">Decider pattern</a>.</sub>
</p>
