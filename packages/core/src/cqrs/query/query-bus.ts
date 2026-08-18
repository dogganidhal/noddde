import { Query, QueryResult } from "./query";

/**
 * Dispatches queries to their registered handlers and returns typed results.
 * The query bus is the primary interface for reading data from projections
 * and read models.
 *
 * @see {@link InMemoryQueryBus} for the built-in in-memory implementation.
 */
export interface QueryBus {
  /**
   * Dispatches a query and returns its result. The return type is automatically
   * inferred from the query's phantom `TResult` type via {@link QueryResult}.
   */
  dispatch<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>>;
}

/**
 * Optional sub-interface for {@link QueryBus} implementations that
 * support local handler registration (e.g. {@link InMemoryQueryBus}).
 *
 * Not part of `QueryBus` itself, for the same reason as
 * {@link CommandHandlerRegistry}: a remote/RPC query bus is a valid
 * `QueryBus` implementation that structurally cannot support local
 * registration. The domain engine checks for this interface structurally
 * on the bus supplied via `DomainWiring.buses` and fails loudly at init
 * if registration is required but unavailable.
 */
export interface QueryHandlerRegistry {
  /**
   * Registers a handler for a given query name.
   *
   * @param queryName - The query `name` to handle.
   * @param handler - The function to invoke when a matching query is dispatched.
   *   Receives the query payload (not the full query object) as its argument.
   */
  register(
    queryName: string,
    handler: (payload: any) => any | Promise<any>,
  ): void;
}
