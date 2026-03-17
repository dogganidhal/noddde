import { DefineQueries } from "@noddde/core";

export type BankAccountView = {
  id: string;
  balance: number;
  transactions: {
    id: string;
    timestamp: Date;
    amount: number;
    status: string;
  }[];
};

export type TransactionView = {
  id: string;
  amount: number;
  merchant: string;
};

export type BankAccountTransactionsView = {
  id: string;
  transactions: TransactionView[];
};

export type BankAccountQuery = DefineQueries<{
  GetBankAccountById: { payload: { id: string }; result: BankAccountView };
  ListBankAccountTransactions: {
    payload: { bankAccountId: string };
    result: BankAccountTransactionsView;
  };
}>;
