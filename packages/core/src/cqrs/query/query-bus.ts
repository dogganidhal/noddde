/* eslint-disable no-unused-vars */
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
