/**
 * Detects a unique-constraint / primary-key violation from a TypeORM error.
 *
 * TypeORM wraps driver errors in `QueryFailedError`, whose `driverError`
 * property carries the original driver error (with the driver's native error
 * code). This checks driver-specific codes first — on both the wrapper and
 * the unwrapped `driverError` — and only falls back to matching the error
 * message when no recognized code is present (e.g. an unwrapped or
 * differently-shaped error from a driver we don't special-case). Driver error
 * codes are stable across locales; error messages are not (PostgreSQL/MySQL
 * localize them via `lc_messages`, so a message-only check silently stops
 * matching on a non-English server).
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as any;

  if (hasUniqueViolationCode(err)) return true;
  if (err.driverError && hasUniqueViolationCode(err.driverError)) return true;

  const message =
    typeof err.message === "string"
      ? err.message
      : typeof err.driverError?.message === "string"
        ? err.driverError.message
        : "";
  return /UNIQUE|duplicate|unique/i.test(message);
}

function hasUniqueViolationCode(err: any): boolean {
  // PostgreSQL: SQLSTATE 23505 (unique_violation)
  if (err.code === "23505") return true;
  // MySQL / MariaDB: ER_DUP_ENTRY / errno 1062
  if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) return true;
  // SQLite (better-sqlite3 / sqlite3): SQLITE_CONSTRAINT*
  if (typeof err.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT"))
    return true;
  // MSSQL: 2627 (PK violation), 2601 (unique index violation)
  if (err.number === 2627 || err.number === 2601) return true;
  return false;
}
