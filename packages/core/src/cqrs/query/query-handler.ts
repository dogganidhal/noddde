/* eslint-disable no-unused-vars */
import { Ports, FrameworkPorts } from "../../ports";
import { Query, QueryResult } from "./query";

/**
 * A function that handles a query by reading from the ports
 * (repositories, caches, databases) and returning the expected result.
 *
 * Query handlers receive the query payload (not the full query object)
 * and have access to ports for data retrieval.
 *
 * @typeParam TPorts - The port dependencies available to the handler.
 * @typeParam TQuery - The query type this handler processes.
 *
 * @param query - The query payload (filters, IDs, etc.).
 * @param ports - External dependencies for data access.
 * @returns The query result, matching the phantom `TResult` type of the query.
 */
export type QueryHandler<TPorts extends Ports, TQuery extends Query<any>> = (
  query: TQuery["payload"],
  ports: TPorts & FrameworkPorts,
) => QueryResult<TQuery> | Promise<QueryResult<TQuery>>;
