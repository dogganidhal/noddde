import { describe, it, expect, vi } from "vitest";
import {
  PrismaAdvisoryLocker,
  withConnectionLimitOne,
} from "../advisory-locker";

/**
 * Minimal mock of the subset of PrismaClient the locker uses. `queryResults`
 * is a queue of rows returned by successive `$queryRawUnsafe` calls; when
 * exhausted it falls back to `defaultRow`.
 */
function makeMockClient(opts?: {
  queryResults?: unknown[][];
  defaultRow?: unknown[];
}) {
  const queue = [...(opts?.queryResults ?? [])];
  const defaultRow = opts?.defaultRow ?? [];
  const $queryRawUnsafe = vi.fn(async () =>
    queue.length > 0 ? queue.shift() : defaultRow,
  );
  const $executeRawUnsafe = vi.fn(async () => undefined);
  const $disconnect = vi.fn(async () => undefined);
  return {
    $queryRawUnsafe,
    $executeRawUnsafe,
    $disconnect,
  } as any;
}

describe("withConnectionLimitOne", () => {
  it("appends connection_limit=1 to a URL with no query string", () => {
    expect(withConnectionLimitOne("postgres://u:p@h:5432/db")).toBe(
      "postgres://u:p@h:5432/db?connection_limit=1",
    );
  });

  it("appends with & when a query string already exists", () => {
    expect(withConnectionLimitOne("mysql://h/db?schema=public")).toBe(
      "mysql://h/db?schema=public&connection_limit=1",
    );
  });

  it("leaves an existing connection_limit untouched", () => {
    const url = "postgres://h/db?connection_limit=5";
    expect(withConnectionLimitOne(url)).toBe(url);
  });
});

describe("PrismaAdvisoryLocker.fromUrl", () => {
  it("passes a connection_limit=1 URL to the clientFactory and owns close()", async () => {
    const client = makeMockClient({ defaultRow: [{ released: true }] });
    const clientFactory = vi.fn(() => client);

    const locker = PrismaAdvisoryLocker.fromUrl(
      "postgres://u:p@h:5432/db",
      "postgresql",
      { clientFactory },
    );

    expect(clientFactory).toHaveBeenCalledWith(
      "postgres://u:p@h:5432/db?connection_limit=1",
    );

    await locker.close();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);

    // close() is idempotent.
    await locker.close();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("PrismaAdvisoryLocker constructor (caller-owned client)", () => {
  it("does not disconnect the caller-owned client on close()", async () => {
    const client = makeMockClient();
    const locker = new PrismaAdvisoryLocker(client, "postgresql");
    await locker.close();
    expect(client.$disconnect).not.toHaveBeenCalled();
  });

  it("warns via the provided logger about session affinity", () => {
    const client = makeMockClient();
    const warn = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    new PrismaAdvisoryLocker(client, "postgresql", { logger });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/connection_limit=1/);
  });

  it("throws at construction for an unsupported dialect", () => {
    const client = makeMockClient();
    expect(() => new PrismaAdvisoryLocker(client, "sqlite" as any)).toThrow(
      /not supported/,
    );
  });
});

describe("release hardening (Postgres)", () => {
  it("throws when a held lock's unlock reports it was not held on this connection", async () => {
    // acquire (no timeout) uses $executeRawUnsafe; release returns released=false.
    const client = makeMockClient({ defaultRow: [{ released: false }] });
    const locker = new PrismaAdvisoryLocker(client, "postgresql");

    await locker.acquire("Order", "o-1");
    await expect(locker.release("Order", "o-1")).rejects.toThrow(
      /different pool connections|not held on this connection/,
    );
  });

  it("does not throw on a double-release (lock not believed held)", async () => {
    const client = makeMockClient({ defaultRow: [{ released: false }] });
    const locker = new PrismaAdvisoryLocker(client, "postgresql");

    // Never acquired → release is an idempotent no-op even though the DB
    // reports released=false.
    await expect(locker.release("Order", "o-1")).resolves.toBeUndefined();
  });

  it("succeeds when the unlock reports released=true", async () => {
    const client = makeMockClient({ defaultRow: [{ released: true }] });
    const locker = new PrismaAdvisoryLocker(client, "postgresql");
    await locker.acquire("Order", "o-1");
    await expect(locker.release("Order", "o-1")).resolves.toBeUndefined();
  });

  it("keeps throwing on a retried release after a failed (wrong-session) unlock", async () => {
    // Every unlock reports released=false (multiplexing). The first release()
    // must throw AND retain the key in _held so a retry still detects the leak
    // instead of being silently swallowed as a double-release.
    const client = makeMockClient({ defaultRow: [{ released: false }] });
    const locker = new PrismaAdvisoryLocker(client, "postgresql");
    await locker.acquire("Order", "o-1");

    await expect(locker.release("Order", "o-1")).rejects.toThrow();
    // The retry still throws — the key was not cleared by the failed release.
    await expect(locker.release("Order", "o-1")).rejects.toThrow();
  });
});

describe("release hardening (MySQL)", () => {
  it("throws when RELEASE_LOCK reports the lock was held by a different session", async () => {
    const client = makeMockClient({
      // acquire GET_LOCK → 1n; release RELEASE_LOCK → 0n (wrong session)
      queryResults: [[{ acquired: 1n }], [{ released: 0n }]],
    });
    const locker = new PrismaAdvisoryLocker(client, "mysql");
    await locker.acquire("Order", "o-1");
    await expect(locker.release("Order", "o-1")).rejects.toThrow(
      /different pool connections|not held on this connection/,
    );
  });

  it("succeeds when RELEASE_LOCK returns 1", async () => {
    const client = makeMockClient({
      queryResults: [[{ acquired: 1n }], [{ released: 1n }]],
    });
    const locker = new PrismaAdvisoryLocker(client, "mysql");
    await locker.acquire("Order", "o-1");
    await expect(locker.release("Order", "o-1")).resolves.toBeUndefined();
  });

  it("keeps throwing on a retried release after a failed (wrong-session) release", async () => {
    const client = makeMockClient({
      // acquire → 1n; both release attempts → 0n (wrong session)
      queryResults: [
        [{ acquired: 1n }],
        [{ released: 0n }],
        [{ released: 0n }],
      ],
    });
    const locker = new PrismaAdvisoryLocker(client, "mysql");
    await locker.acquire("Order", "o-1");

    await expect(locker.release("Order", "o-1")).rejects.toThrow();
    // The retry still throws — the name was not cleared by the failed release.
    await expect(locker.release("Order", "o-1")).rejects.toThrow();
  });
});
