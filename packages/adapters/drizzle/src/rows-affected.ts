/**
 * Extracts the affected-row count from a Drizzle UPDATE result across
 * dialects/drivers. Each surfaces it on a different shape: better-sqlite3
 * uses `changes`, node-postgres uses `rowCount`, `drizzle-orm/postgres-js`
 * uses `count`, and mysql2 returns a `ResultSetHeader` with `affectedRows`
 * (sometimes wrapped in an array `[ResultSetHeader, ...]` by drizzle's
 * mysql2 session) — probe all of them.
 */
export function getRowsAffected(result: any): number {
  return (
    result?.rowsAffected ??
    result?.changes ??
    result?.rowCount ??
    result?.count ??
    result?.affectedRows ??
    result?.[0]?.affectedRows ??
    0
  );
}
