/* eslint-disable no-unused-vars */

/**
 * Branded symbol used to carry the phantom `TResult` type on query types.
 * Unlike interface type parameters, branded symbols survive intersections —
 * enabling {@link QueryResult} to extract the result type from
 * {@link DefineQueries} output (which is an intersection type).
 *
 * @internal Not part of the public API — only used by the type system.
 */
declare const _queryResult: unique symbol;

/**
 * Base interface for all queries. Queries represent questions asked to the
 * read model and carry a phantom `TResult` type via a branded symbol
 * property, extractable via {@link QueryResult}.
 *
 * Use {@link DefineQueries} to build query unions from a payload map instead
 * of declaring each query interface manually.
 *
 * @typeParam TResult - The expected result type (carried via branded symbol).
 * @typeParam TQueryNames - The query name literal type (defaults to `string`).
 */
export interface Query<TResult, TQueryNames extends string | symbol = string> {
  /** Discriminant field used to identify the query type and enable type narrowing. */
  name: TQueryNames;
  /** Optional data carried by the query (e.g., filters, IDs). */
  payload?: any;
  /**
   * Phantom brand carrying the result type. Never set at runtime.
   * @internal
   */
  readonly [_queryResult]?: TResult;
}

/**
 * Extracts the result type from a query type by reading the branded
 * symbol property.
 *
 * @typeParam TQuery - The query type to extract the result from.
 *
 * @example
 * ```ts
 * type Result = QueryResult<GetBankAccountByIdQuery>; // BankAccountView
 * ```
 */
export type QueryResult<TQuery extends Query<any>> = TQuery extends {
  readonly [_queryResult]?: infer TResult;
}
  ? TResult
  : never;

/**
 * Builds a discriminated union of query types from a definition map.
 * Each key becomes a query `name`. Each value specifies a `result` type
 * and an optional `payload` type.
 *
 * The result type is carried via the branded symbol — NOT by intersecting
 * with the full {@link Query} interface. This keeps `payload` uncontaminated
 * (avoids `T & any = any`).
 *
 * @typeParam TDefinitions - A record mapping query names to their definitions.
 *   Each definition has a required `result` type and an optional `payload` type.
 *   Omit `payload` or use `void` for queries with no payload.
 *
 * @example
 * ```ts
 * type AccountQuery = DefineQueries<{
 *   GetAccountById: { payload: { id: string }; result: AccountView };
 *   ListAccounts: { result: AccountView[] };
 * }>;
 *
 * type R = QueryResult<Extract<AccountQuery, { name: "GetAccountById" }>>;
 * //   ^? AccountView
 * ```
 */
export type DefineQueries<
  TDefinitions extends Record<string, { payload?: any; result: any }>,
> = {
  [K in keyof TDefinitions & string]: (TDefinitions[K] extends {
    payload: infer P;
  }
    ? P extends void
      ? { name: K }
      : { name: K; payload: P }
    : { name: K }) & {
    readonly [_queryResult]?: TDefinitions[K]["result"];
  };
}[keyof TDefinitions & string];
