/* eslint-disable no-unused-vars */
import type { Aggregate, AggregateTypes } from "@noddde/core";
import type { AggregateTestResult } from "./types";

/**
 * Pure helper that replays a sequence of events through an aggregate's
 * apply handlers to produce the resulting state. No command handler is
 * invoked — this is purely the "evolve" side of the Decider.
 *
 * @typeParam T - The {@link AggregateTypes} bundle.
 * @param aggregate - The aggregate definition.
 * @param events - Events to replay (in order).
 * @param initialState - Optional starting state; defaults to `aggregate.initialState`.
 * @returns The state after replaying all events.
 *
 * @example
 * ```ts
 * const state = evolveAggregate(BankAccount, [
 *   { name: "AccountCreated", payload: { id: "acc-1" } },
 *   { name: "DepositMade", payload: { amount: 100 } },
 * ]);
 * expect(state.balance).toBe(100);
 * ```
 */
export function evolveAggregate<T extends AggregateTypes>(
  aggregate: Aggregate<T>,
  events: T["events"][],
  initialState?: T["state"],
): T["state"] {
  return events.reduce((state: T["state"], event: T["events"]) => {
    const handler = (aggregate.apply as Record<string, any>)[event.name];
    return handler ? handler(event.payload, state) : state;
  }, initialState ?? aggregate.initialState);
}

/**
 * Builder interface for aggregate Given-When-Then tests.
 * @typeParam T - The {@link AggregateTypes} bundle.
 */
export interface AggregateTestBuilder<T extends AggregateTypes> {
  /**
   * Adds prior events to replay through apply handlers to build the
   * pre-command state. Can be called multiple times; events accumulate.
   */
  given(...events: T["events"][]): AggregateTestBuilder<T>;

  /**
   * Sets the command to execute. Returns a builder that allows
   * setting infrastructure and executing the test.
   */
  when(command: T["commands"]): AggregateTestBuilderWithCommand<T>;
}

/**
 * Builder interface after a command has been set.
 * @typeParam T - The {@link AggregateTypes} bundle.
 */
export interface AggregateTestBuilderWithCommand<T extends AggregateTypes> {
  /**
   * Provides infrastructure to the command handler.
   * Defaults to `{}` if not called.
   */
  withInfrastructure(
    infrastructure: T["infrastructure"],
  ): AggregateTestBuilderWithCommand<T>;

  /**
   * Executes the test scenario:
   * 1. Replays given events through apply handlers from initialState
   * 2. Invokes the command handler with the resulting state
   * 3. Applies produced events to get the final state
   * 4. Returns `{ events, state }` or `{ error }` if anything threw
   *
   * Never throws — errors are captured in the result.
   */
  execute(): Promise<AggregateTestResult<T["state"], T["events"]>>;
}

/**
 * Creates a Given-When-Then test harness for an aggregate.
 *
 * Follows the Decider test pattern:
 * - **Given** = prior events replayed through `apply` to build state
 * - **When** = command executed through the command handler
 * - **Then** = assert on produced events and resulting state
 *
 * @typeParam T - The {@link AggregateTypes} bundle.
 * @param aggregate - The aggregate definition to test.
 * @returns A builder with `.given()`, `.when()`, and `.execute()` methods.
 *
 * @example
 * ```ts
 * const result = await testAggregate(BankAccount)
 *   .given(
 *     { name: "AccountCreated", payload: { id: "a1" } },
 *     { name: "DepositMade", payload: { amount: 100 } },
 *   )
 *   .when({
 *     name: "AuthorizeTransaction",
 *     targetAggregateId: "a1",
 *     payload: { amount: 50 },
 *   })
 *   .execute();
 *
 * expect(result.events).toHaveLength(1);
 * expect(result.state.availableBalance).toBe(50);
 * ```
 */
export function testAggregate<T extends AggregateTypes>(
  aggregate: Aggregate<T>,
): AggregateTestBuilder<T> {
  const givenEvents: T["events"][] = [];
  let command: T["commands"] | undefined;
  let infrastructure: T["infrastructure"] | undefined;

  const builder: AggregateTestBuilder<T> & AggregateTestBuilderWithCommand<T> =
    {
      given(...events: T["events"][]) {
        givenEvents.push(...events);
        return builder;
      },

      when(cmd: T["commands"]) {
        command = cmd;
        return builder;
      },

      withInfrastructure(infra: T["infrastructure"]) {
        infrastructure = infra;
        return builder;
      },

      async execute(): Promise<AggregateTestResult<T["state"], T["events"]>> {
        const priorState = evolveAggregate(aggregate, givenEvents);

        try {
          const handler = (aggregate.commands as Record<string, any>)[
            command!.name
          ];
          const rawResult = await handler(
            command,
            priorState,
            infrastructure ?? ({} as T["infrastructure"]),
          );

          const events: T["events"][] = Array.isArray(rawResult)
            ? rawResult
            : [rawResult];

          const state = evolveAggregate(aggregate, events, priorState);

          return { events, state };
        } catch (err) {
          return {
            events: [],
            state: priorState,
            error: err instanceof Error ? err : new Error(String(err)),
          };
        }
      },
    };

  return builder;
}
