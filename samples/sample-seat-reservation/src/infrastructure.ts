import type { Infrastructure } from "@noddde/core";

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface VenueInfrastructure extends Infrastructure {
  clock: Clock;
}
