/**
 * Base interface for all queries. Queries represent questions asked to the
 * read model and carry a phantom `TResult` type that encodes the expected
 * return type at the type level.
 *
 * Use {@link DefineQueries} to build query unions from a definition map instead
 * of declaring each query interface manually.
 *
 * @typeParam TResult - The expected result type (phantom — not stored in a field,
 *   but extractable via {@link QueryResult}).
 * @typeParam TQueryNames - The query name literal type (defaults to `string`).
 */
export interface Query<TResult, TQueryNames extends string | symbol = string> {
  /** Discriminant field used to identify the query type and enable type narrowing. */
  name: TQueryNames;
  /** Optional data carried by the query (e.g., filters, IDs). */
  payload?: any;
}

/**
 * Extracts the result type from a query type. Works by inferring the phantom
 * `TResult` parameter from the {@link Query} constraint.
 *
 * @typeParam TQuery - The query type to extract the result from.
 *
 * @example
 * ```ts
 * type Result = QueryResult<GetBankAccountByIdQuery>; // BankAccountView
 * ```
 */
export type QueryResult<TQuery extends Query<any>> =
  TQuery extends Query<infer TResult> ? TResult : never;

/**
 * Builds a discriminated union of query types from a definition map.
 * Each key becomes a query `name`. Each value specifies a `result` type
 * and an optional `payload` type. The generated types carry the result
 * as a phantom type, so {@link QueryResult} can extract it.
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
    : { name: K }) &
    Query<TDefinitions[K]["result"], K>;
}[keyof TDefinitions & string];
