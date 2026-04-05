/* eslint-disable no-unused-vars */
import { Event } from "./event";
import { Ports, FrameworkPorts } from "../ports";

/**
 * An impure, async-capable handler that reacts to domain events.
 * Used in projections to update read models, send notifications,
 * or trigger downstream processes.
 *
 * Unlike {@link EvolveHandler}, event handlers have access to ports
 * and may perform I/O. The handler receives the full event object (including
 * optional {@link EventMetadata}), consistent with projection reducers and
 * saga event handlers.
 *
 * @typeParam TEvent - The event type this handler processes.
 * @typeParam TPorts - The port dependencies available to the handler.
 *
 * @param event - The full event object (name, payload, and optional metadata).
 * @param ports - External dependencies (repositories, services, etc.).
 */
export type EventHandler<TEvent extends Event, TPorts extends Ports> = (
  event: TEvent,
  ports: TPorts & FrameworkPorts,
) => void | Promise<void>;
