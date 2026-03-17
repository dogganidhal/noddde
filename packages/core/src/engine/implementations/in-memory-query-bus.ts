import { Query, QueryBus, QueryResult } from "../../cqrs";

/**
 * In-memory {@link QueryBus} implementation that dispatches queries to
 * registered handlers within the same process.
 *
 * Suitable for development, testing, and single-process applications.
 */
export class InMemoryQueryBus implements QueryBus {
  constructor() {}

  public async dispatch<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>> {
    throw new Error("Method not implemented.");
  }
}
