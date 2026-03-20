/**
 * Union of serializable identifier types supported by the framework.
 *
 * `ID` serves as the upper bound for all aggregate, saga, and entity
 * identifier type parameters. Domains can use any of these types for
 * their aggregate and saga IDs:
 *
 * - `string` — UUIDs, ULIDs, slugs, and other string-based identifiers.
 * - `number` — Auto-increment integer IDs and small numeric identifiers.
 * - `bigint` — 64-bit database IDs (PostgreSQL `bigserial`, Snowflake IDs).
 *
 * Branded types that extend `string`, `number`, or `bigint` are also
 * accepted (e.g., `string & { __brand: "UserId" }`).
 *
 * @example
 * ```ts
 * // String UUIDs (default)
 * type AccountCommand = DefineCommands<{ Create: void }>;
 * // → targetAggregateId: string
 *
 * // Numeric auto-increment IDs
 * type OrderCommand = DefineCommands<{ PlaceOrder: { item: string } }, number>;
 * // → targetAggregateId: number
 *
 * // BigInt snowflake IDs
 * type UserCommand = DefineCommands<{ Register: { name: string } }, bigint>;
 * // → targetAggregateId: bigint
 * ```
 */
export type ID = string | number | bigint;
