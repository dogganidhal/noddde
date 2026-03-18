/* eslint-disable no-unused-vars */
import { Event } from "./event";
import { Infrastructure } from "../infrastructure";

/**
 * An impure, async-capable handler that reacts to domain events.
 * Used in projections to update read models, send notifications,
 * or trigger downstream processes.
 *
 * Unlike {@link ApplyHandler}, event handlers have access to infrastructure
 * and may perform I/O.
 *
 * @typeParam TEvent - The event type this handler processes.
 * @typeParam TInfrastructure - The infrastructure dependencies available to the handler.
 *
 * @param event - The event payload (not the full event envelope).
 * @param infrastructure - External dependencies (repositories, services, etc.).
 */
export type EventHandler<
  TEvent extends Event,
  TInfrastructure extends Infrastructure,
> = (
  event: TEvent["payload"],
  infrastructure: TInfrastructure,
) => void | Promise<void>;
