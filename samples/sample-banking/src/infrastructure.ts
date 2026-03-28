/* eslint-disable no-unused-vars */
import { BankAccountView, TransactionView } from "./queries";
import { SetRequired } from "type-fest";

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private readonly date: Date) {}
  now(): Date {
    return this.date;
  }
}

export interface BankAccountViewRepository {
  getById(id: string): Promise<BankAccountView>;
  insert(bankAccount: BankAccountView): Promise<void>;
  update(
    bankAccount: SetRequired<Partial<BankAccountView>, "id">,
  ): Promise<void>;
}

export class InMemoryBankAccountViewRepository
  implements BankAccountViewRepository
{
  getById(id: string): Promise<BankAccountView> {
    throw new Error("Method not implemented.");
  }

  insert(bankAccount: BankAccountView): Promise<void> {
    throw new Error("Method not implemented.");
  }

  update(
    bankAccount: SetRequired<Partial<BankAccountView>, "id">,
  ): Promise<void> {
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

export interface BankingInfrastructure {
  clock: Clock;

  bankAccountViewRepository: BankAccountViewRepository;
  transactionViewRepository: TransactionViewRepository;
}
