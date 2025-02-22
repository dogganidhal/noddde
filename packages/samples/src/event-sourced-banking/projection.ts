import { Projection, ProjectionV2 } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";
import { BankAccountEvent, BankAccountEvents } from "./events";
import { BankAccount as BankAccountAggregate } from "./aggregate";
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
    BankAccountCreated: (event, { bankAccountViewRepository }) => {
      bankAccountViewRepository.insert(event);
    },
    TransactionProcessed: (event, infrastructure) => {},
    TransactionDeclined: (event, infrastructure) => {},
    TransactionAuthorized: (event, infrastructure) => {},
  },
};

export type BankAccountView = {
  id: string;
  balance: number;
  transactions: {
    id: string;
    timestamp: Date;
    amount: number;
    status: "processed" | "declined" | "authorized";
  }[];
};

export const BankAccountV2: ProjectionV2<BankAccountEvent, BankAccountView> = {
  reducer: (view, event) => {
    switch (event.name) {
      case BankAccountEvents.BankAccountCreated:
        return {
          id: event.payload.id,
          balance: 0,
          transactions: [],
        };
      case BankAccountEvents.TransactionProcessed:
        return {
          ...view,
          balance: view.balance + event.payload.amount,
          transactions: [
            ...view.transactions,
            {
              id: event.payload.id,
              timestamp: event.payload.timestamp,
              amount: event.payload.amount,
              status: "processed",
            },
          ],
        };
      case BankAccountEvents.TransactionDeclined:
      case BankAccountEvents.TransactionAuthorized:
        return view;
    }
  },
};
