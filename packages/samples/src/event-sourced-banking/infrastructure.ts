import { BankAccountView, TransactionView } from "./queries";

export type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
};

export interface BankAccountViewRepository {
  getById(id: string): Promise<BankAccountView>;
}

export class InMemoryBankAccountViewRepository
  implements BankAccountViewRepository
{
  getById(id: string): Promise<BankAccountView> {
    throw new Error("Method not implemented.");
  }
}

export interface TransactionViewRepository {
  listByBankAccountId(bankAccountId: string): Promise<TransactionView[]>;
}

export class InMemoryTransactionViewRepository
  implements TransactionViewRepository
{
  listByBankAccountId(bankAccountId: string): Promise<TransactionView[]> {
    throw new Error("Method not implemented.");
  }
}

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

export interface BankingInfrastructure {
  logger: Logger;

  bankAccountViewRepository: BankAccountViewRepository;
  transactionViewRepository: TransactionViewRepository;
}
