/* eslint-disable no-unused-vars */
import type { ID, Saga, SagaTypes, CQRSPorts } from "@noddde/core";
import { NoopLogger } from "@noddde/engine";
import type { SagaTestResult } from "./types";

/**
 * Creates a no-op CQRSPorts for saga unit tests.
 * Saga handlers receive `TPorts & CQRSPorts`,
 * but most handlers only use the custom ports portion
 * and return commands in the reaction rather than dispatching directly.
 */
function createNoopCQRSPorts(): CQRSPorts {
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
   * Provides custom ports to the handler.
   * No-op {@link CQRSPorts} are automatically merged.
   */
  withPorts(ports: T["ports"]): SagaTestBuilderWithEvent<T>;

  /**
   * Provides custom {@link CQRSPorts} (overriding the default no-op).
   * Useful when the saga handler calls `commandBus.dispatch` directly.
   */
  withCQRSPorts(cqrs: Partial<CQRSPorts>): SagaTestBuilderWithEvent<T>;

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
 * Ports are automatically augmented with no-op
 * {@link CQRSPorts} so saga handlers receive the expected type
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
  let ports: T["ports"] | undefined;
  let cqrsOverride: Partial<CQRSPorts> | undefined;

  const builder: SagaTestBuilder<T> & SagaTestBuilderWithEvent<T> = {
    givenState(state: T["state"]) {
      currentState = state;
      return builder;
    },

    when(evt: T["events"]) {
      event = evt;
      return builder;
    },

    withPorts(p: T["ports"]) {
      ports = p;
      return builder;
    },

    withCQRSPorts(cqrs: Partial<CQRSPorts>) {
      cqrsOverride = cqrs;
      return builder;
    },

    async execute(): Promise<SagaTestResult<T["state"], T["commands"]>> {
      const state = currentState ?? saga.initialState;

      try {
        const handler = (saga.on as Record<string, any>)[event!.name]?.handle;

        const noopCqrs = createNoopCQRSPorts();
        const mergedPorts = {
          logger: new NoopLogger(),
          ...(ports ?? ({} as T["ports"])),
          ...noopCqrs,
          ...cqrsOverride,
        };

        const reaction = await handler(event, state, mergedPorts);

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
