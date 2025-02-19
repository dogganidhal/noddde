import { Projection } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";
import { BankAccountEvents } from "./events";
import {
  BankAccountQueries,
  getBankAccountByIdQueryHandler,
  listBankAccountTransactionsQueryHandler,
} from "./queries";

export const BankAccount: Projection<
  BankingInfrastructure,
  BankAccountEvents,
  BankAccountQueries
> = {
  queryHandlers: {
    GetBankAccountById: getBankAccountByIdQueryHandler,
    ListBankAccountTransactions: listBankAccountTransactionsQueryHandler,
  },
  eventHandlers: {
    BankAccountCreated: (event, infrastructure) => {},
    TransactionProcessed: (event, infrastructure) => {},
    TransactionDeclined: (event, infrastructure) => {},
    TransactionAuthorized: (event, infrastructure) => {},
  },
};
