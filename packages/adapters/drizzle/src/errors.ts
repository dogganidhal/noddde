/**
 * Detects a unique-constraint violation across dialects using driver error
 * codes rather than matching (localized) error messages. PG/MySQL error
 * messages are translated via `lc_messages`, so a message-only check misses
 * violations on non-English servers.
 *
 * Falls back to a message regex only when no recognized driver code is
 * present, to keep working with wrapped/older drivers that don't expose one.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;

  // PostgreSQL (node-postgres, postgres-js): SQLSTATE 23505
  if (err.code === "23505") return true;

  // MySQL / MariaDB (mysql2): ER_DUP_ENTRY / errno 1062
  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) return true;

  // SQLite (better-sqlite3): SQLITE_CONSTRAINT, SQLITE_CONSTRAINT_PRIMARYKEY, SQLITE_CONSTRAINT_UNIQUE, ...
  if (
    typeof err.code === "string" &&
    err.code.startsWith("SQLITE_CONSTRAINT")
  ) {
    return true;
  }

  // Last resort: no recognized driver code present, fall back to message matching.
  const message = typeof err.message === "string" ? err.message : "";
  return /UNIQUE constraint failed|unique constraint|Duplicate entry|duplicate key/i.test(
    message,
  );
}
