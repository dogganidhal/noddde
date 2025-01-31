import { BankingInfrastructure } from "./infrastructure";
import {
  authorizeTransactionCommandHandler,
  BankAccountCommands,
  createBankAccountCommandHandler,
} from "./commands";
import {
  bankAccountCreatedEventHandler,
  BankAccountEvents,
  transactionAuthorizedEventHandler,
  transactionDeclinedEventHandler,
  transactionProcessedEventHandler,
} from "./events";
import { AggregateRoot } from "@noddde/core";
import {
  bankAccountCreatedEventSourcingHandler,
  transactionAuthorizedEventSourcingHandler,
  transactionDeclinedEventSourcingHandler,
  transactionProcessedEventSourcingHandler,
} from "./event-sourcing";

export interface BankAccountState {
  id: string;
  balance: number;
  availableBalance: number;
  transactions: Array<{
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  }>;
}

export const BankAccount: AggregateRoot<
  string,
  BankAccountState,
  BankingInfrastructure,
  BankAccountEvents,
  BankAccountCommands
> = {
  commandHandlers: {
    CreateBankAccount: createBankAccountCommandHandler,
    AuthorizeTransaction: authorizeTransactionCommandHandler,
  },
  eventHandlers: {
    BankAccountCreated: bankAccountCreatedEventHandler,
    TransactionAuthorized: transactionAuthorizedEventHandler,
    TransactionProcessed: transactionProcessedEventHandler,
    TransactionDeclined: transactionDeclinedEventHandler,
  },
  eventSourcingHandlers: {
    BankAccountCreated: bankAccountCreatedEventSourcingHandler,
    TransactionAuthorized: transactionAuthorizedEventSourcingHandler,
    TransactionDeclined: transactionDeclinedEventSourcingHandler,
    TransactionProcessed: transactionProcessedEventSourcingHandler,
  },
};
