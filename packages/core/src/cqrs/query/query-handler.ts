/* eslint-disable no-unused-vars */
import { Infrastructure, FrameworkInfrastructure } from "../../infrastructure";
import { Query, QueryResult } from "./query";

/**
 * A function that handles a query by reading from the infrastructure
 * (repositories, caches, databases) and returning the expected result.
 *
 * Query handlers receive the query payload (not the full query object)
 * and have access to infrastructure for data retrieval.
 *
 * @typeParam TInfrastructure - The infrastructure dependencies available to the handler.
 * @typeParam TQuery - The query type this handler processes.
 *
 * @param query - The query payload (filters, IDs, etc.).
 * @param infrastructure - External dependencies for data access.
 * @returns The query result, matching the phantom `TResult` type of the query.
 */
export type QueryHandler<
  TInfrastructure extends Infrastructure,
  TQuery extends Query<any>,
> = (
  query: TQuery["payload"],
  infrastructure: TInfrastructure & FrameworkInfrastructure,
) => QueryResult<TQuery> | Promise<QueryResult<TQuery>>;
