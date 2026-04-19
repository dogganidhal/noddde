# @noddde/core

TypeScript types and definitions for DDD, CQRS, and Event Sourcing using the functional Decider pattern.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/core
# or
npm install @noddde/core
```

## What's Inside

`@noddde/core` is the foundation of the noddde framework. It provides:

- **Aggregate definitions** (`defineAggregate`) with the Decider pattern: `initialState`, `decide`, `evolve`
- **Saga definitions** (`defineSaga`) for orchestrating cross-aggregate workflows as pure functions
- **Projection definitions** (`defineProjection`) for building read models from event streams
- **CQRS abstractions** for command and query buses, handlers, and typed messages
- **Event-driven types** for event buses, event handlers, and domain events with metadata
- **Persistence interfaces** for event-sourced and state-stored strategies
- **Infrastructure contracts** for locking, snapshots, outbox, idempotency, and unit of work

Zero runtime dependencies. Strict TypeScript with full type inference.

## Usage

```typescript
import {
  defineAggregate,
  type DefineCommands,
  type DefineEvents,
  type Infrastructure,
} from "@noddde/core";

type BankAccountEvent = DefineEvents<{
  DepositMade: { amount: number };
  WithdrawalMade: { amount: number };
}>;

type BankAccountCommand = DefineCommands<{
  Deposit: { amount: number };
  Withdraw: { amount: number };
}>;

type BankAccountDef = {
  state: { balance: number };
  events: BankAccountEvent;
  commands: BankAccountCommand;
  infrastructure: Infrastructure;
};

const BankAccount = defineAggregate<BankAccountDef>({
  initialState: { balance: 0 },

  decide: {
    Deposit: (command, state) => ({
      name: "DepositMade",
      payload: { amount: command.payload.amount },
    }),
    Withdraw: (command, state) => {
      if (state.balance < command.payload.amount) {
        throw new Error("Insufficient funds");
      }
      return {
        name: "WithdrawalMade",
        payload: { amount: command.payload.amount },
      };
    },
  },

  evolve: {
    DepositMade: (payload, state) => ({
      balance: state.balance + payload.amount,
    }),
    WithdrawalMade: (payload, state) => ({
      balance: state.balance - payload.amount,
    }),
  },
});
```

## Related Packages

| Package                                                            | Description                                                            |
| :----------------------------------------------------------------- | :--------------------------------------------------------------------- |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)   | Runtime engine with domain orchestration and in-memory implementations |
| [`@noddde/testing`](https://www.npmjs.com/package/@noddde/testing) | Test harnesses for aggregates, sagas, projections, and domains         |
| [`@noddde/drizzle`](https://www.npmjs.com/package/@noddde/drizzle) | Drizzle ORM persistence adapter                                        |
| [`@noddde/prisma`](https://www.npmjs.com/package/@noddde/prisma)   | Prisma persistence adapter                                             |
| [`@noddde/typeorm`](https://www.npmjs.com/package/@noddde/typeorm) | TypeORM persistence adapter                                            |

## License

MIT
