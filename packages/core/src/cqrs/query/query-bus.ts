import { Query, QueryResult } from "./query";

export interface QueryBus {
  dispatch<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>>;
}
