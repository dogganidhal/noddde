/* eslint-disable no-unused-vars */
import type { Projection, ProjectionTypes } from "@noddde/core";
import type { ProjectionTestResult } from "./types";

/**
 * Builder interface for projection tests.
 * @typeParam T - The {@link ProjectionTypes} bundle.
 */
export interface ProjectionTestBuilder<T extends ProjectionTypes> {
  /**
   * Sets the initial view before any events are applied.
   * If not called, reducers receive `undefined` as the initial view
   * (matching real projection behavior on first event).
   */
  initialView(view: T["view"]): ProjectionTestBuilder<T>;

  /**
   * Adds events to replay through the projection's reducers.
   * Can be called multiple times; events accumulate in order.
   */
  given(...events: T["events"][]): ProjectionTestBuilder<T>;

  /**
   * Executes the test: replays all given events through reducers
   * starting from the initial view.
   *
   * Never throws — errors are captured in the result.
   */
  execute(): Promise<ProjectionTestResult<T["view"]>>;
}

/**
 * Creates a test harness for a projection. Replays events through
 * the projection's reducers and returns the final view.
 *
 * @typeParam T - The {@link ProjectionTypes} bundle.
 * @param projection - The projection definition to test.
 * @returns A builder with `.initialView()`, `.given()`, and `.execute()` methods.
 *
 * @example
 * ```ts
 * const result = await testProjection(BankProjection)
 *   .initialView({ accounts: new Map() })
 *   .given(
 *     { name: "AccountCreated", payload: { id: "a1" } },
 *     { name: "DepositMade", payload: { amount: 100 } },
 *   )
 *   .execute();
 *
 * expect(result.view.accounts.get("a1").balance).toBe(100);
 * ```
 */
export function testProjection<T extends ProjectionTypes>(
  projection: Projection<T>,
): ProjectionTestBuilder<T> {
  const events: T["events"][] = [];
  let startView: T["view"] | undefined;

  const builder: ProjectionTestBuilder<T> = {
    initialView(view: T["view"]) {
      startView = view;
      return builder;
    },

    given(...evts: T["events"][]) {
      events.push(...evts);
      return builder;
    },

    async execute(): Promise<ProjectionTestResult<T["view"]>> {
      try {
        let currentView = startView as T["view"];

        for (const event of events) {
          const reducer = (projection.reducers as Record<string, any>)[
            event.name
          ];
          if (reducer) {
            currentView = await reducer(event, currentView);
          }
        }

        return { view: currentView };
      } catch (err) {
        return {
          view: startView as T["view"],
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
  };

  return builder;
}
