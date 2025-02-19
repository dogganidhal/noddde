export interface Query<TResult, TQueryNames extends string | symbol = string> {
  name: TQueryNames;
  payload?: any;
}

export type QueryResult<TQuery extends Query<any>> =
  TQuery extends Query<infer TResult> ? TResult : never;
