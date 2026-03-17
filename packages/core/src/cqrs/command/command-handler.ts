import { Infrastructure, CQRSInfrastructure } from "../../infrastructure";
import { StandaloneCommand } from "./command";

/**
 * A handler for standalone commands (commands not routed to an aggregate).
 * Receives the full infrastructure merged with CQRS buses, enabling it to
 * dispatch further commands, publish events, or query read models.
 *
 * Use cases include sagas, process managers, integration workflows, and notifications.
 *
 * @typeParam TInfrastructure - The custom infrastructure dependencies.
 * @typeParam TCommand - The standalone command type this handler processes.
 *
 * @param command - The full command object.
 * @param infrastructure - Custom infrastructure merged with {@link CQRSInfrastructure}.
 */
export type StandaloneCommandHandler<
  TInfrastructure extends Infrastructure,
  TCommand extends StandaloneCommand,
> = (
  command: TCommand,
  infrastructure: TInfrastructure & CQRSInfrastructure,
) => void | Promise<void>;
