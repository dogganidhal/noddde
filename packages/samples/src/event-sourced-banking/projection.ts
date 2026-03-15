import { Projection, ProjectionV2 } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";
import { BankAccountEvent } from "./events";
import {
  BankAccountQueries,
  getBankAccountByIdQueryHandler,
  listBankAccountTransactionsQueryHandler,
} from "./queries";

export const BankAccount: Projection<
  BankingInfrastructure,
  BankAccountEvent["name"],
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
    TransactionProcessed: (_event, _infrastructure) => {},
    TransactionDeclined: (_event, _infrastructure) => {},
    TransactionAuthorized: (_event, _infrastructure) => {},
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
      case "BankAccountCreated":
        return {
          id: event.payload.id,
          balance: 0,
          transactions: [],
        };
      case "TransactionProcessed":
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
      case "TransactionDeclined":
      case "TransactionAuthorized":
        return view;
    }
  },
};
