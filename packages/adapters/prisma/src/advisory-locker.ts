/* eslint-disable no-unused-vars */
import type { PrismaClient } from "@prisma/client";
import type { AggregateLocker, Closeable, Logger } from "@noddde/core";
import { PostgresLocker } from "./pg/advisory-locker";
import { MySQLLocker } from "./mysql/advisory-locker";

export type PrismaDialect = "postgresql" | "mysql" | "mariadb";

/** Options accepted by {@link PrismaAdvisoryLocker}. */
export interface PrismaAdvisoryLockerOptions {
  /**
   * Optional framework logger. When provided, the caller-owned-client
   * constructor path emits a one-time warning that advisory locks require
   * session affinity (a `connection_limit=1` client). Defaults to no logging.
   */
  logger?: Logger;
}

/** Options accepted by {@link PrismaAdvisoryLocker.fromUrl}. */
export interface PrismaAdvisoryLockerFromUrlOptions
  extends PrismaAdvisoryLockerOptions {
  /**
   * Factory that builds the PrismaClient from the connection-limit-pinned URL.
   * Use this when your client is generated to a custom output location (e.g.
   * dialect-specific clients). When omitted, the standard `@prisma/client`
   * `PrismaClient` is imported lazily and constructed with
   * `{ datasources: { db: { url } } }`.
   */
  clientFactory?: (url: string) => PrismaClient;
}

/**
 * Appends `connection_limit=1` to a Prisma connection URL, preserving any
 * existing query string and leaving an already-present `connection_limit`
 * untouched (so an explicit value the caller set is not silently overridden —
 * though only `1` is safe for advisory locks).
 */
export function withConnectionLimitOne(url: string): string {
  // Cheap check first to avoid constructing a URL for the common case.
  if (/[?&]connection_limit=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=1`;
}

let cachedPrismaCtor: (new (options: unknown) => PrismaClient) | undefined;

/**
 * Lazily resolves the `PrismaClient` constructor from `@prisma/client`.
 *
 * Loaded lazily (not via a top-level `import`) so that merely importing
 * `@noddde/prisma` does not require a generated Prisma client — only callers
 * of {@link PrismaAdvisoryLocker.fromUrl} without a `clientFactory` do.
 *
 * Resolution is **module-relative** (Node's normal upward `node_modules`
 * lookup from this file), not CWD-relative, so it works regardless of the
 * process working directory. The CJS build has a native module-relative
 * `require`; the ESM build gets an equivalent one injected by a banner
 * (`createRequire(import.meta.url)`) in `tsup.config.ts`.
 */
function loadPrismaClientCtor(): new (options: unknown) => PrismaClient {
  if (cachedPrismaCtor) return cachedPrismaCtor;
  const mod = require("@prisma/client") as {
    PrismaClient: new (options: unknown) => PrismaClient;
  };
  if (typeof mod?.PrismaClient !== "function") {
    throw new Error(
      "PrismaAdvisoryLocker.fromUrl: could not load PrismaClient from " +
        '"@prisma/client". Ensure @prisma/client is installed and generated, ' +
        "or pass options.clientFactory to build the client yourself.",
    );
  }
  cachedPrismaCtor = mod.PrismaClient;
  return cachedPrismaCtor;
}

/**
 * Database-backed {@link AggregateLocker} using advisory locks via Prisma.
 *
 * Supports PostgreSQL (`pg_advisory_lock`), MySQL (`GET_LOCK`),
 * and MariaDB (`GET_LOCK`, same as MySQL).
 * SQLite is not supported — use {@link InMemoryAggregateLocker}
 * for single-process SQLite deployments.
 *
 * ## Session affinity (important)
 *
 * Advisory locks are **session-scoped**: a lock acquired on one DB session
 * must be released on the *same* session, or the release is a no-op and the
 * lock leaks. Prisma multiplexes queries across an internal connection pool,
 * so a locker built from an ordinary (default-pool) `PrismaClient` may
 * `acquire()` on one connection and `release()` on another.
 *
 * Prefer {@link PrismaAdvisoryLocker.fromUrl}, which owns a client pinned to
 * `connection_limit=1` and therefore guarantees session affinity. If you pass
 * your own `PrismaClient` to the constructor, it must be pinned to a single
 * connection. As a safety net, `release()` throws loudly if it detects that a
 * lock it acquired was released on a different connection.
 *
 * @example
 * ```ts
 * import { PrismaAdvisoryLocker } from "@noddde/prisma";
 * import { wireDomain } from "@noddde/engine";
 *
 * // Recommended: the locker owns a single-connection client.
 * const locker = PrismaAdvisoryLocker.fromUrl(
 *   process.env.DATABASE_URL!,
 *   "postgresql",
 * );
 *
 * const domain = await wireDomain(definition, {
 *   aggregates: {
 *     concurrency: { strategy: "pessimistic", locker, lockTimeoutMs: 5000 },
 *   },
 * });
 *
 * // On shutdown (also auto-discovered by the engine via Closeable):
 * await locker.close();
 * ```
 */
export class PrismaAdvisoryLocker implements AggregateLocker, Closeable {
  private readonly inner: AggregateLocker;
  /**
   * The client this locker owns and must disconnect on `close()`. `null` when
   * the locker wraps a caller-owned client (the caller disconnects it).
   */
  private ownedClient: { $disconnect(): Promise<void> } | null = null;
  private closed = false;

  /**
   * Wraps an existing `PrismaClient`. Advanced: the client **must** be pinned
   * to a single connection (`connection_limit=1`) for advisory locks to be
   * safe. Prefer {@link PrismaAdvisoryLocker.fromUrl}.
   */
  constructor(
    prisma: PrismaClient,
    dialect: PrismaDialect,
    options?: PrismaAdvisoryLockerOptions,
  ) {
    if (dialect === "postgresql") {
      this.inner = new PostgresLocker(prisma);
    } else if (dialect === "mysql" || dialect === "mariadb") {
      this.inner = new MySQLLocker(prisma);
    } else {
      throw new Error(
        `Pessimistic locking is not supported with ${String(dialect)}. ` +
          "Use InMemoryAggregateLocker for single-process deployments.",
      );
    }

    options?.logger?.warn(
      "PrismaAdvisoryLocker was constructed from a caller-owned PrismaClient. " +
        "Advisory locks are session-scoped and Prisma multiplexes over its " +
        "connection pool — ensure this client is pinned to connection_limit=1, " +
        "or use PrismaAdvisoryLocker.fromUrl() instead.",
      { dialect },
    );
  }

  /**
   * Recommended constructor. Builds and owns a `PrismaClient` pinned to
   * `connection_limit=1`, guaranteeing that `acquire()` and `release()` run on
   * the same DB session. Call {@link PrismaAdvisoryLocker.close} to disconnect
   * the owned client (the engine also auto-discovers it via `Closeable`).
   */
  static fromUrl(
    url: string,
    dialect: PrismaDialect,
    options?: PrismaAdvisoryLockerFromUrlOptions,
  ): PrismaAdvisoryLocker {
    const pinnedUrl = withConnectionLimitOne(url);
    const client = options?.clientFactory
      ? options.clientFactory(pinnedUrl)
      : new (loadPrismaClientCtor())({
          datasources: { db: { url: pinnedUrl } },
        });

    // Build via the plain constructor, then take ownership. Do not forward the
    // logger warning here — the owned client is guaranteed single-connection.
    const locker = new PrismaAdvisoryLocker(client, dialect);
    locker.ownedClient = client as unknown as {
      $disconnect(): Promise<void>;
    };
    return locker;
  }

  acquire(
    aggregateName: string,
    aggregateId: string,
    timeoutMs?: number,
  ): Promise<void> {
    return this.inner.acquire(aggregateName, aggregateId, timeoutMs);
  }

  release(aggregateName: string, aggregateId: string): Promise<void> {
    return this.inner.release(aggregateName, aggregateId);
  }

  /**
   * Disconnects the internally-owned client. No-op when the locker was built
   * from a caller-owned client. Idempotent.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.ownedClient) {
      await this.ownedClient.$disconnect();
      this.ownedClient = null;
    }
  }
}
