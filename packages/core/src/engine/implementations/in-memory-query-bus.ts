import { Query, QueryBus, QueryResult } from "../../cqrs";

/** Handler function type for query bus registration. */
type QueryHandlerFn = (payload: any) => any | Promise<any>;

/**
 * In-memory {@link QueryBus} implementation that dispatches queries to
 * registered handlers within the same process.
 *
 * Queries are routed by their `name` field to a handler registered via
 * {@link register}. Only one handler per query name is allowed — registering
 * a duplicate throws immediately to surface configuration bugs.
 *
 * Suitable for development, testing, and single-process applications.
 */
export class InMemoryQueryBus implements QueryBus {
  private readonly handlers = new Map<string, QueryHandlerFn>();

  /**
   * Registers a handler for a given query name.
   *
   * @param queryName - The query `name` to handle.
   * @param handler - The function to invoke when a matching query is dispatched.
   *   Receives the query payload (not the full query object) as its argument.
   * @throws If a handler is already registered for the given query name.
   */
  public register(queryName: string, handler: QueryHandlerFn): void {
    if (this.handlers.has(queryName)) {
      throw new Error(
        `Handler already registered for query: ${queryName}`,
      );
    }
    this.handlers.set(queryName, handler);
  }

  /**
   * Dispatches a query to its registered handler.
   *
   * @param query - The query to dispatch. Must have a `name` field matching a registered handler.
   * @returns A promise that resolves with the handler's return value.
   * @throws If no handler is registered for the query name.
   * @throws If the handler throws synchronously or rejects asynchronously.
   */
  public async dispatch<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>> {
    const handler = this.handlers.get(query.name as string);
    if (!handler) {
      throw new Error(
        `No handler registered for query: ${query.name as string}`,
      );
    }
    return await handler(query.payload);
  }
}
