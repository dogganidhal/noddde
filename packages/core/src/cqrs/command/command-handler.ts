import { Infrastructure, CQRSInfrastructure } from "../../infrastructure";
import { StandaloneCommand } from "./command";

export type StandaloneCommandHandler<
  TInfrastructure extends Infrastructure,
  TCommand extends StandaloneCommand,
> = (
  command: TCommand,
  infrastructure: TInfrastructure & CQRSInfrastructure,
) => void | Promise<void>;
