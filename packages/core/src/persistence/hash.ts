/**
 * FNV-1a 64-bit hash function. Produces a deterministic signed BigInt
 * from a string key, suitable for use as a PostgreSQL advisory lock key.
 *
 * Uses the standard FNV-1a parameters:
 * - Offset basis: `0xcbf29ce484222325`
 * - Prime: `0x100000001b3`
 *
 * The output is converted to a signed 64-bit integer to match
 * PostgreSQL's `bigint` type (used by `pg_advisory_lock`).
 *
 * @param key - The string to hash (typically `${aggregateName}:${aggregateId}`).
 * @returns A signed 64-bit BigInt suitable for PostgreSQL advisory lock keys.
 *
 * @example
 * ```ts
 * const lockKey = fnv1a64("BankAccount:acc-1");
 * await db.execute(sql`SELECT pg_advisory_lock(${lockKey}::bigint)`);
 * ```
 */
export function fnv1a64(key: string): bigint {
  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn; // 2^64 - 1

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < key.length; i++) {
    hash ^= BigInt(key.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK;
  }

  // Convert unsigned 64-bit to signed 64-bit (PostgreSQL bigint is signed)
  if (hash >= 0x8000000000000000n) {
    hash -= 0x10000000000000000n;
  }
  return hash;
}
