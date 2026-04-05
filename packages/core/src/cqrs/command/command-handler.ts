/* eslint-disable no-unused-vars */
import { Ports, CQRSPorts, FrameworkPorts } from "../../ports";
import { StandaloneCommand } from "./command";

/**
 * A handler for standalone commands (commands not routed to an aggregate).
 * Receives the full ports merged with CQRS buses, enabling it to
 * dispatch further commands, publish events, or query read models.
 *
 * Use cases include sagas, process managers, integration workflows, and notifications.
 *
 * @typeParam TPorts - The custom port dependencies.
 * @typeParam TCommand - The standalone command type this handler processes.
 *
 * @param command - The full command object.
 * @param ports - Custom ports merged with {@link CQRSPorts} and {@link FrameworkPorts}.
 */
export type StandaloneCommandHandler<
  TPorts extends Ports,
  TCommand extends StandaloneCommand,
> = (
  command: TCommand,
  ports: TPorts & CQRSPorts & FrameworkPorts,
) => void | Promise<void>;
