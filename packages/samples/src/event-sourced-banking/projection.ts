import { defineProjection, ProjectionTypes } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";
import { BankAccountEvent } from "./events";
import { BankAccountQuery, BankAccountView } from "./queries";

type BankAccountProjectionDef = {
  events: BankAccountEvent;
  queries: BankAccountQuery;
  view: BankAccountView;
  infrastructure: BankingInfrastructure;
};

export const BankAccountProjection =
  defineProjection<BankAccountProjectionDef>({
    reducers: {
      BankAccountCreated: (event) => ({
        id: event.payload.id,
        balance: 0,
        transactions: [],
      }),
      TransactionAuthorized: (event, view) => ({
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
      }),
      TransactionProcessed: (_, view) => view,
      TransactionDeclined: (_, view) => view,
    },
    queryHandlers: {
      GetBankAccountById: async (query, { bankAccountViewRepository }) =>
        bankAccountViewRepository.getById(query.id),
      ListBankAccountTransactions: async (
        query,
        { transactionViewRepository },
      ) => {
        return {
          id: query.bankAccountId,
          transactions: await transactionViewRepository.listByBankAccountId(
            query.bankAccountId,
          ),
        };
      },
    },
  });
