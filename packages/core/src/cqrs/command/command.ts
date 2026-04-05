import type { ID } from "../../id";

/**
 * Base interface for all commands. Commands represent an intent to perform
 * an action in the domain. They are named in the imperative mood
 * (e.g., `CreateAccount`, `AuthorizeTransaction`).
 *
 * Use {@link DefineCommands} to build command unions from a payload map instead
 * of declaring each command interface manually.
 */
export interface Command {
  /** Discriminant field used to identify the command type and enable type narrowing. */
  name: string;
  /** Optional data carried by the command. Use `void` in {@link DefineCommands} to omit. */
  payload?: any;
  /**
   * Optional unique identifier for idempotent command processing.
   * When present and an {@link IdempotencyStore} is configured on the domain,
   * the engine checks this value to skip duplicate commands.
   */
  commandId?: ID;
}

/**
 * A command targeting a specific aggregate instance. Extends {@link Command}
 * with a `targetAggregateId` that the framework uses to route the command
 * to the correct aggregate and load its state.
 *
 * @typeParam TID - The type of the aggregate identifier. Bounded by {@link ID}, defaults to `string`.
 */
export interface AggregateCommand<TID extends ID = string> extends Command {
  /** Identifies which aggregate instance should handle this command. */
  targetAggregateId: TID;
}

/**
 * A command that is not routed to an aggregate. Standalone commands are handled
 * by standalone command handlers which receive the full ports
 * (including CQRS buses) but no aggregate state.
 *
 * Use cases include sagas, process managers, integration commands, and notifications.
 */
export type StandaloneCommand = Command;

/**
 * Builds a discriminated union of aggregate command types from a payload map.
 * Each key becomes a command `name`, and the value becomes its `payload` type.
 * Use `void` for commands that carry no payload.
 *
 * @typeParam TPayloads - A record mapping command names to their payload types.
 *   Use `void` for commands with no payload.
 * @typeParam TID - The type of `targetAggregateId`. Bounded by {@link ID}, defaults to `string`.
 *
 * @example
 * ```ts
 * type AccountCommand = DefineCommands<{
 *   CreateAccount: void;
 *   AuthorizeTransaction: { amount: number; merchant: string };
 * }>;
 * // Equivalent to:
 * // | { name: "CreateAccount"; targetAggregateId: string }
 * // | { name: "AuthorizeTransaction"; targetAggregateId: string; payload: { amount: number; merchant: string } }
 * ```
 */
export type DefineCommands<
  TPayloads extends Record<string, any>,
  TID extends ID = string,
> = {
  [K in keyof TPayloads & string]: TPayloads[K] extends void
    ? { name: K; targetAggregateId: TID }
    : { name: K; targetAggregateId: TID; payload: TPayloads[K] };
}[keyof TPayloads & string];
