/**
 * Polls `check` until it returns truthy or the timeout elapses.
 * Used in integration tests to wait for asynchronous side effects
 * (broker delivery, projection rebuild) without arbitrary sleeps.
 */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  if (lastErr) throw lastErr;
  throw new Error(
    opts.message
      ? `waitFor timed out after ${timeoutMs}ms: ${opts.message}`
      : `waitFor timed out after ${timeoutMs}ms`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns a random suffix string for namespacing test resources
 * (queue names, topic names, table prefixes) so parallel suites
 * don't collide on shared brokers.
 */
export function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * `it.runIf(condition)` shim that defers to `it.skip` when the condition
 * is false. Used to silently skip integration tests when Docker isn't
 * available locally — CI always has it.
 */
export function dockerAvailable(): boolean {
  // We don't actively probe — testcontainers itself errors out fast if the
  // Docker daemon isn't reachable. This is a soft toggle so devs can run
  // `INTEGRATION=1 yarn test:integration` and skip otherwise.
  return process.env.INTEGRATION === "1" || process.env.CI === "true";
}
