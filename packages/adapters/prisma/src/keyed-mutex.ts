/**
 * A per-key, in-process mutex. Composed in front of a DB-level advisory lock
 * to close the residual re-entrancy hole: PostgreSQL/MySQL advisory locks
 * are session-scoped, not call-scoped, so two concurrent commands sharing
 * one pinned connection (e.g. via `PrismaAdvisoryLocker.fromUrl`) would
 * otherwise both "acquire" the same DB lock.
 *
 * ponytail: process-local only — does not help across multiple processes
 * sharing one pinned connection (not a supported topology; each process
 * that locks should own its own pinned session).
 */
export class KeyedMutex {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly release = new Map<string, () => void>();

  /** Waits for any in-flight holder of `key` to release, then takes it. */
  async lock(key: string): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = this.pending.get(key);
      if (!current) break;
      await current.catch(() => undefined);
    }
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pending.set(key, held);
    this.release.set(key, release);
  }

  /** Releases `key`, letting the next queued `lock(key)` proceed. */
  unlock(key: string): void {
    const release = this.release.get(key);
    if (!release) return;
    this.release.delete(key);
    this.pending.delete(key);
    release();
  }
}
