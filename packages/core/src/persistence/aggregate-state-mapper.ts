/**
 * Bi-directional mapper between an aggregate's state object and the
 * state portion of a row in a dedicated persistence schema.
 *
 * The mapper handles only state ⇄ state-row translation. The adapter
 * writes the aggregate id and version columns itself, using column
 * references declared on the per-adapter mapper interface that
 * extends this one (e.g. `DrizzleStateMapper`, `PrismaStateMapper`,
 * `TypeORMStateMapper`).
 *
 * Mappers must be pure and total: `fromRow(toRow(state))` must equal
 * `state` for every valid state value. `toRow` and `fromRow` must not
 * mutate their inputs.
 *
 * @typeParam TState - The aggregate's state type.
 * @typeParam TRow   - The shape of the row's state portion (i.e. the
 *                     full row minus the aggregate-id and version
 *                     columns the adapter manages).
 *
 * @example
 * ```ts
 * type OrderState = { customerId: string; total: number };
 * type OrderRow = { customerId: string; total: number };
 *
 * const mapper: AggregateStateMapper<OrderState, OrderRow> = {
 *   toRow: (s) => ({ customerId: s.customerId, total: s.total }),
 *   fromRow: (r) => ({ customerId: r.customerId, total: r.total }),
 * };
 * ```
 */
export interface AggregateStateMapper<TState, TRow extends object> {
  /** State → state-row to write. */
  // eslint-disable-next-line no-unused-vars
  toRow(state: TState): TRow;
  /** State-row (id and version columns already stripped) → state. */
  // eslint-disable-next-line no-unused-vars
  fromRow(row: TRow): TState;
}
