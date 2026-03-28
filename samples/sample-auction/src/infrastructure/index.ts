/** Provides the current time to command handlers. */
export interface Clock {
  /** Returns the current date/time. */
  now(): Date;
}

/** System clock implementation using the real wall clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Infrastructure dependencies for the auction domain. */
export interface AuctionInfrastructure {
  /** Clock used for time-based bid validation. */
  clock: Clock;
}
