import { Command } from "./command";

export interface CommandBus {
  dispatch(command: Command): Promise<void>;
}
