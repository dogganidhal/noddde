import type { Event, Command } from "@noddde/core";

/**
 * The result of executing a command in an aggregate test harness.
 * Captures the produced events, the resulting state, and any error.
 *
 * @typeParam TState - The aggregate state type.
 * @typeParam TEvents - The event union type.
 */
export type AggregateTestResult<TState, TEvents extends Event> = {
  /** Events returned by the command handler, normalized to an array. */
  events: TEvents[];
  /** State after applying all produced events to the pre-command state. */
  state: TState;
  /** If the command handler or an apply handler threw, the error is captured here. */
  error?: Error;
};

/**
 * The result of replaying events through a projection test harness.
 *
 * @typeParam TView - The projection view type.
 */
export type ProjectionTestResult<TView> = {
  /** The final view after applying all events through reducers. */
  view: TView;
  /** If any reducer threw, the error is captured here. */
  error?: Error;
};

/**
 * The result of processing an event through a saga test harness.
 *
 * @typeParam TState - The saga state type.
 * @typeParam TCommands - The command union type.
 */
export type SagaTestResult<TState, TCommands extends Command> = {
  /** The new saga state after the handler executed. */
  state: TState;
  /** Commands to dispatch, normalized to an array (empty if none). */
  commands: TCommands[];
  /** If the handler threw, the error is captured here. */
  error?: Error;
};

/**
 * Spy data captured by {@link testDomain}. Records all events and commands
 * that flowed through the domain's buses during the test.
 */
export type DomainSpy = {
  /** All events dispatched via the event bus, in order. */
  publishedEvents: Event[];
  /** All commands dispatched via the command bus, in order. */
  dispatchedCommands: Command[];
};
