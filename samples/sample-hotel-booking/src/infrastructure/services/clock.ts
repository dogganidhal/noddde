import type { Clock } from "../types";

/** Uses the real system clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Returns a fixed date — deterministic for tests. */
export class FixedClock implements Clock {
  // eslint-disable-next-line no-unused-vars
  constructor(private readonly date: Date) {}
  now(): Date {
    return this.date;
  }
}
