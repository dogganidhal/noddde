# @noddde/testing

Test harnesses and utilities for noddde domains: Given / When / Then style testing for aggregates, projections, sagas, and full domain integration tests.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add --dev @noddde/testing
# or
npm install --save-dev @noddde/testing
```

## What's Inside

- **`testAggregate`** / **`evolveAggregate`** &mdash; Unit test aggregate decide and evolve handlers
- **`testProjection`** &mdash; Unit test projection reducers
- **`testSaga`** &mdash; Unit test saga handlers and returned commands
- **`testDomain`** &mdash; Integration test a full domain with command dispatch and event flow
- **Metadata utilities** &mdash; `stripMetadata`, `expectValidMetadata`, `expectSameCorrelation`, `expectCausationChain`

No database or broker setup required. All harnesses run entirely in-memory.

## Usage

### Aggregate Testing

```typescript
import { testAggregate } from "@noddde/testing";
import { BankAccount } from "../aggregates/bank-account";

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

### Saga Testing

```typescript
import { testSaga } from "@noddde/testing";
import { OrderFulfillmentSaga } from "../sagas/order-fulfillment";

const result = await testSaga(OrderFulfillmentSaga)
  .given({ orderId: "order-1", status: "pending" })
  .when({
    name: "PaymentCompleted",
    payload: { orderId: "order-1", shipmentId: "ship-1" },
  })
  .execute();

expect(result.commands).toHaveLength(2);
expect(result.state.status).toBe("awaiting_shipment");
```

### Domain Integration Testing

```typescript
import { testDomain } from "@noddde/testing";

const { commandBus, queryBus, spy } = await testDomain(domainDefinition);

await commandBus.dispatch({
  name: "Deposit",
  targetAggregateId: "acc-1",
  payload: { amount: 100 },
});

expect(spy.publishedEvents).toContainEqual(
  expect.objectContaining({ name: "DepositMade" }),
);
```

## Related Packages

| Package                                                          | Description                                 |
| :--------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)     | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine) | Runtime engine with domain orchestration    |

## License

MIT
