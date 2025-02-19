import { Query, QueryBus, QueryResult } from "../../cqrs";

export class InMemoryQueryBus implements QueryBus {
  constructor() {}

  public async dispatch<TQuery extends Query<any>>(
    query: TQuery,
  ): Promise<QueryResult<TQuery>> {
    throw new Error("Method not implemented.");
  }
}
