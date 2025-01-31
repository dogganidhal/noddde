import { Infrastructure } from "@noddde/core";

export type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
};

export class ConsoleLogger implements Logger {
  info(message: string) {
    console.log(message);
  }

  error(message: string) {
    console.error(message);
  }

  warn(message: string) {
    console.warn(message);
  }
}

export interface BankingInfrastructure extends Infrastructure {
  logger: Logger;
}
