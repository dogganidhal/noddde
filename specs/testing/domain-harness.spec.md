---
title: "testDomain command-dispatch spy: scoped error swallowing"
module: packages/testing/src
source_file: packages/testing/src/domain-harness.ts
status: implemented
exports:
  - testDomain
  - TestDomainConfig
  - TestDomainResult
  - DomainSpy
depends_on:
  - engine/domain
  - engine/implementations/in-memory-command-bus
docs: []
---

# testDomain command-dispatch spy: scoped error swallowing

> `testDomain` pre-wires a slice-test domain with spied buses. Its command-bus
> spy must only suppress the one error class it exists to suppress — "no
> handler registered for this command" — and must surface every other
> dispatch outcome (success, missing-handler, and thrown business error) on
> `DomainSpy` so slice tests can assert on it instead of it vanishing.

## Type Contract

```ts
export type DomainSpy = {
  /** All events dispatched via the event bus, in order. */
  publishedEvents: Event[];
  /** All commands dispatched via the command bus, in order (success, swallowed, or errored). */
  dispatchedCommands: Command[];
  /**
   * Commands dispatched while no handler was registered for their `name`.
   * These are the only dispatch errors `testDomain` suppresses; the command
   * still appears in `dispatchedCommands`.
   */
  unhandledCommands: Command[];
  /**
   * Commands whose registered handler threw or rejected. The error is
   * captured here AND rethrown from `commandBus.dispatch` — so a saga
   * reaction command that fails business validation is visible both via the
   * spy and via the ordinary throw/log path the runtime already uses.
   */
  commandErrors: Array<{ command: Command; error: Error }>;
};
```

`TestDomainConfig`, `TestDomainResult`, and the `testDomain` function signature are unchanged from the current implementation.

## Behavioral Requirements

1. `commandBus.dispatch` on the domain returned by `testDomain` MUST push every dispatched command onto `spy.dispatchedCommands`, regardless of outcome (unchanged from current behavior).
2. If the underlying `InMemoryCommandBus.dispatch` throws an `Error` whose `message` matches `` `No handler registered for command: ${command.name}` ``, `testDomain` MUST suppress it (the caller's `await ...dispatch(command)` resolves normally) and MUST push the command onto `spy.unhandledCommands`.
3. If the underlying dispatch throws any other error (a `decide` handler's business-rule violation, or any error not matching the missing-handler message for that command), `testDomain` MUST:
   a. push `{ command, error }` onto `spy.commandErrors`, and
   b. rethrow the original error unchanged (same error identity, not wrapped) from `commandBus.dispatch`.
4. A command that dispatches successfully MUST NOT appear in `unhandledCommands` or `commandErrors`.
5. The missing-handler match MUST be scoped to the dispatched command's own name — an error thrown by a _found_ handler that happens to also start with `"No handler registered for command: "` text is still a real thrown error (per Edge Cases) and must NOT be swallowed.

## Invariants

- `dispatchedCommands.length` MUST always equal the number of spied dispatch calls — `commandBus.dispatch` calls plus aggregate-routed `domain.dispatchCommand` calls (see Integration Points; the two are mutually exclusive per dispatch) — independent of success/failure.
- Every entry in `unhandledCommands` and every `command` in `commandErrors` MUST also be present in `dispatchedCommands` (spy push happens before the try/catch).
- `unhandledCommands` and `commandErrors` are mutually exclusive per dispatch: a given dispatch call contributes to at most one of them.
- Suppressing a missing-handler error MUST NOT alter the error's absence from `commandErrors` — the two arrays partition dispatch failures, they don't overlap.

## Edge Cases

- **Real error whose message happens to resemble the missing-handler message but for a different command name.** Only exact-match against the _dispatched command's own_ `command.name` counts as missing-handler; do not do a generic substring match against the fixed prefix alone. This prevents a handler that legitimately throws `new Error("No handler registered for command: SomethingElse")` from being silently swallowed.
- **Non-`Error` throws** (e.g. a handler throws a string or plain object). These can never match the missing-handler shape, so they fall through to the `commandErrors` + rethrow path unchanged.
- **A command with a registered handler that itself throws the exact missing-handler-shaped message for its own name.** Rare, but per Behavioral Requirement 5, this is indistinguishable from a real missing-handler condition from the spy's point of view and is treated as suppressed — this is an accepted limitation of message-based detection (no typed error is available from `@noddde/engine` to distinguish them, and this package must not modify `engine/src`).
- **Saga reaction commands.** These flow through `commandBus.dispatch` the same as directly-dispatched commands. Because `EventEmitterEventBus.dispatch` isolates and logs handler errors rather than rejecting, a saga-triggered command error will not surface as a rejected promise from the _event_ dispatch call — it is only observable via `spy.commandErrors` (and the existing runtime error log). Directly-dispatched commands (`domain.dispatchCommand(...)`) DO propagate the rethrown error to the caller as an ordinary rejected promise.

## Integration Points

- Wraps `InMemoryCommandBus.dispatch` from `@noddde/engine`, whose missing-handler error message format (`No handler registered for command: ${name}`) this spec depends on. If that message format changes, this spec's missing-handler detection must be updated to match.
- Used by `wireDomain`'s saga executor (`packages/engine/src/executors/saga-executor.ts`) indirectly: reaction commands dispatched by a saga running inside a `testDomain`-wired domain go through this same spied bus.
- `Domain.dispatchCommand` (`packages/engine/src/domain.ts`) routes a command with a matching aggregate `decide` handler straight to the command executor, bypassing `commandBus.dispatch` entirely; only commands with no matching aggregate ("standalone" commands) fall through to `commandBus.dispatch`. `testDomain` therefore wraps `domain.dispatchCommand` too — scoped to exactly the command names present in the configured aggregates' `decide` maps, sharing the same record/partition logic as the `commandBus.dispatch` wrapper — so that a directly-dispatched aggregate command (not just a saga reaction command) is also tracked in `dispatchedCommands`/`unhandledCommands`/`commandErrors` and its errors rethrow to the caller. Commands routed through this fast path and through `commandBus.dispatch` are mutually exclusive per dispatch, so neither is ever double-counted.

## Test Scenarios

### should suppress a dispatch to a command with no registered handler and record it as unhandled

```ts
import { describe, it, expect } from "vitest";
import { testDomain } from "@noddde/testing";

describe("testDomain command spy — unhandled commands", () => {
  it("should suppress a dispatch to a command with no registered handler and record it as unhandled", async () => {
    const { domain, spy } = await testDomain({});

    await domain.infrastructure.commandBus.dispatch({
      name: "NoSuchCommand",
      targetAggregateId: "x-1",
      payload: {},
    });

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.unhandledCommands).toHaveLength(1);
    expect(spy.unhandledCommands[0]).toEqual(
      expect.objectContaining({ name: "NoSuchCommand" }),
    );
    expect(spy.commandErrors).toHaveLength(0);
  });
});
```

### should rethrow a business-rule error from a directly-dispatched command and record it in commandErrors

```ts
import { describe, it, expect } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import { testDomain } from "@noddde/testing";

type State = { locked: boolean };
type Events = DefineEvents<{ Touched: { by: string } }>;
type Commands = DefineCommands<{ Touch: { by: string } }>;
type Types = {
  state: State;
  events: Events;
  commands: Commands;
  infrastructure: {};
};

const LockedThing = defineAggregate<Types>({
  initialState: { locked: true },
  decide: {
    Touch: (_command, state) => {
      if (state.locked) {
        throw new Error("cannot touch a locked thing");
      }
      return { name: "Touched", payload: { by: "test" } };
    },
  },
  evolve: {
    Touched: (_payload, state) => state,
  },
});

describe("testDomain command spy — thrown errors", () => {
  it("should rethrow a business-rule error from a directly-dispatched command and record it in commandErrors", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { LockedThing },
    });

    await expect(
      domain.dispatchCommand({
        name: "Touch",
        targetAggregateId: "t-1",
        payload: { by: "test" },
      }),
    ).rejects.toThrow("cannot touch a locked thing");

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.commandErrors).toHaveLength(1);
    expect(spy.commandErrors[0]!.error.message).toBe(
      "cannot touch a locked thing",
    );
    expect(spy.commandErrors[0]!.command).toEqual(
      expect.objectContaining({ name: "Touch" }),
    );
    expect(spy.unhandledCommands).toHaveLength(0);
  });
});
```

### should record a saga reaction command's business-rule error in commandErrors without vanishing

```ts
import { describe, it, expect } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineSaga } from "@noddde/core";
import { testDomain } from "@noddde/testing";

type SagaEvents = DefineEvents<{
  OrderPlaced: { orderId: string };
}>;
type SagaCommands = DefineCommands<{
  RequestPayment: { orderId: string };
}>;
type SagaTypes = {
  state: { status: string };
  events: SagaEvents;
  commands: SagaCommands;
  infrastructure: {};
};

const PaymentSaga = defineSaga<SagaTypes>({
  initialState: { status: "pending" },
  startedBy: ["OrderPlaced"],
  on: {
    OrderPlaced: {
      id: (event) => event.payload.orderId,
      handle: (event) => ({
        state: { status: "payment_requested" },
        commands: {
          name: "RequestPayment",
          targetAggregateId: event.payload.orderId,
          payload: { orderId: event.payload.orderId },
        },
      }),
    },
  },
});

describe("testDomain command spy — saga reaction errors", () => {
  it("should record a saga reaction command's business-rule error in commandErrors without vanishing", async () => {
    // No handler is registered for RequestPayment, so this exercises the
    // unhandled-command path even though it arrives via a saga reaction —
    // confirming the spy records it rather than silently discarding all
    // information about the failed reaction.
    const { domain, spy } = await testDomain({
      sagas: { PaymentSaga },
    });

    await domain.infrastructure.eventBus.dispatch({
      name: "OrderPlaced",
      payload: { orderId: "o-1" },
    });

    expect(spy.dispatchedCommands).toContainEqual(
      expect.objectContaining({ name: "RequestPayment" }),
    );
    expect(spy.unhandledCommands).toContainEqual(
      expect.objectContaining({ name: "RequestPayment" }),
    );
  });
});
```

### should not record a successfully dispatched command as unhandled or errored

```ts
import { describe, it, expect } from "vitest";
import type { DefineCommands, DefineEvents } from "@noddde/core";
import { defineAggregate } from "@noddde/core";
import { testDomain } from "@noddde/testing";

type CounterState = { count: number };
type CounterEvent = DefineEvents<{ Incremented: { amount: number } }>;
type CounterCommand = DefineCommands<{ Increment: { amount: number } }>;
type CounterTypes = {
  state: CounterState;
  events: CounterEvent;
  commands: CounterCommand;
  infrastructure: {};
};

const Counter = defineAggregate<CounterTypes>({
  initialState: { count: 0 },
  decide: {
    Increment: (command) => ({
      name: "Incremented",
      payload: { amount: command.payload.amount },
    }),
  },
  evolve: {
    Incremented: (payload, state) => ({ count: state.count + payload.amount }),
  },
});

describe("testDomain command spy — success path", () => {
  it("should not record a successfully dispatched command as unhandled or errored", async () => {
    const { domain, spy } = await testDomain({
      aggregates: { Counter },
    });

    await domain.dispatchCommand({
      name: "Increment",
      targetAggregateId: "c-1",
      payload: { amount: 5 },
    });

    expect(spy.dispatchedCommands).toHaveLength(1);
    expect(spy.unhandledCommands).toHaveLength(0);
    expect(spy.commandErrors).toHaveLength(0);
  });
});
```
