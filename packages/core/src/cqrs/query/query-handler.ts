import { Infrastructure } from "../../infrastructure";
import { Query, QueryResult } from "./query";

export type QueryHandler<
  TInfrastructure extends Infrastructure,
  TQuery extends Query<any>,
> = (
  query: TQuery["payload"],
  infrastructure: TInfrastructure,
) => QueryResult<TQuery> | Promise<QueryResult<TQuery>>;
