/* eslint-disable no-unused-vars */
import type { ID, Saga, SagaTypes, CQRSInfrastructure } from "@noddde/core";
import type { SagaTestResult } from "./types";

/**
 * Creates a no-op CQRSInfrastructure for saga unit tests.
 * Saga handlers receive `TInfrastructure & CQRSInfrastructure`,
 * but most handlers only use the custom infrastructure portion
 * and return commands in the reaction rather than dispatching directly.
 */
function createNoopCQRSInfrastructure(): CQRSInfrastructure {
  return {
    commandBus: { dispatch: async () => {} },
    eventBus: { dispatch: async () => {} },
    queryBus: { dispatch: async () => undefined as any },
  };
}

/**
 * Builder interface for saga tests.
 * @typeParam T - The {@link SagaTypes} bundle.
 */
export interface SagaTestBuilder<T extends SagaTypes> {
  /**
   * Sets the saga state before the event is processed.
   * If not called, uses `saga.initialState`.
   */
  givenState(state: T["state"]): SagaTestBuilder<T>;

  /**
   * Sets the event to process through the saga handler.
   */
  when(event: T["events"]): SagaTestBuilderWithEvent<T>;
}

/**
 * Builder interface after an event has been set.
 * @typeParam T - The {@link SagaTypes} bundle.
 */
export interface SagaTestBuilderWithEvent<T extends SagaTypes> {
  /**
   * Provides custom infrastructure to the handler.
   * A no-op CQRSInfrastructure is automatically merged.
   */
  withInfrastructure(
    infrastructure: T["infrastructure"],
  ): SagaTestBuilderWithEvent<T>;

  /**
   * Provides a custom CQRSInfrastructure (overriding the default no-op).
   * Useful when the saga handler calls `commandBus.dispatch` directly.
   */
  withCQRSInfrastructure(
    cqrs: Partial<CQRSInfrastructure>,
  ): SagaTestBuilderWithEvent<T>;

  /**
   * Executes the test:
   * 1. Uses givenState (or initialState)
   * 2. Invokes the saga handler for the event
   * 3. Returns `{ state, commands }` or `{ error }`
   *
   * Never throws — errors are captured in the result.
   */
  execute(): Promise<SagaTestResult<T["state"], T["commands"]>>;
}

/**
 * Creates a Given-When-Then test harness for a saga.
 * The inverse Decider pattern: event in, commands out.
 *
 * Infrastructure is automatically augmented with a no-op
 * {@link CQRSInfrastructure} so saga handlers receive the expected type
 * without manual bus wiring.
 *
 * @typeParam T - The {@link SagaTypes} bundle.
 * @typeParam TSagaId - The saga instance identifier type.
 * @param saga - The saga definition to test.
 * @returns A builder with `.givenState()`, `.when()`, and `.execute()` methods.
 *
 * @example
 * ```ts
 * const result = await testSaga(OrderFulfillmentSaga)
 *   .givenState({ status: "awaiting_payment", orderId: "o-1" })
 *   .when({ name: "PaymentReceived", payload: { orderId: "o-1", paymentId: "p-1" } })
 *   .execute();
 *
 * expect(result.state.status).toBe("fulfilled");
 * expect(result.commands).toEqual([
 *   { name: "FulfillOrder", targetAggregateId: "o-1" },
 * ]);
 * ```
 */
export function testSaga<T extends SagaTypes, TSagaId extends ID = string>(
  saga: Saga<T, TSagaId>,
): SagaTestBuilder<T> {
  let currentState: T["state"] | undefined;
  let event: T["events"] | undefined;
  let infrastructure: T["infrastructure"] | undefined;
  let cqrsOverride: Partial<CQRSInfrastructure> | undefined;

  const builder: SagaTestBuilder<T> & SagaTestBuilderWithEvent<T> = {
    givenState(state: T["state"]) {
      currentState = state;
      return builder;
    },

    when(evt: T["events"]) {
      event = evt;
      return builder;
    },

    withInfrastructure(infra: T["infrastructure"]) {
      infrastructure = infra;
      return builder;
    },

    withCQRSInfrastructure(cqrs: Partial<CQRSInfrastructure>) {
      cqrsOverride = cqrs;
      return builder;
    },

    async execute(): Promise<SagaTestResult<T["state"], T["commands"]>> {
      const state = currentState ?? saga.initialState;

      try {
        const handler = (saga.handlers as Record<string, any>)[event!.name];

        const noopCqrs = createNoopCQRSInfrastructure();
        const mergedInfra = {
          ...(infrastructure ?? ({} as T["infrastructure"])),
          ...noopCqrs,
          ...cqrsOverride,
        };

        const reaction = await handler(event, state, mergedInfra);

        const commands: T["commands"][] = reaction.commands
          ? Array.isArray(reaction.commands)
            ? reaction.commands
            : [reaction.commands]
          : [];

        return { state: reaction.state, commands };
      } catch (err) {
        return {
          state,
          commands: [],
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
  };

  return builder;
}
