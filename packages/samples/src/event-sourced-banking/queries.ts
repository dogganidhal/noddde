import { Query, QueryHandler } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";

export enum BankAccountQueries {
  GetBankAccountById = "GetBankAccountById",
  ListBankAccountTransactions = "ListBankAccountTransactions",
}

export type BankAccountView = {
  id: string;
  balance: number;
};

export interface GetBankAccountByIdQuery extends Query<BankAccountView> {
  name: BankAccountQueries.GetBankAccountById;
  payload: {
    id: string;
  };
}

export type TransactionView = {
  id: string;
  amount: number;
  merchant: string;
};

export type BankAccountTransactionsView = {
  id: string;
  transactions: TransactionView[];
};

export interface ListBankAccountTransactionsQuery
  extends Query<BankAccountTransactionsView> {
  name: BankAccountQueries.ListBankAccountTransactions;
  payload: {
    bankAccountId: string;
  };
}

export const getBankAccountByIdQueryHandler: QueryHandler<
  BankingInfrastructure,
  GetBankAccountByIdQuery
> = async (query, { bankAccountViewRepository }) => {
  return bankAccountViewRepository.getById(query.id);
};

export const listBankAccountTransactionsQueryHandler: QueryHandler<
  BankingInfrastructure,
  ListBankAccountTransactionsQuery
> = async (query, { transactionViewRepository }) => {
  return {
    id: query.bankAccountId,
    transactions: await transactionViewRepository.listByBankAccountId(
      query.bankAccountId,
    ),
  };
};
