import { DefineEvents } from "@noddde/core";

export type BankAccountEvent = DefineEvents<{
  BankAccountCreated: { id: string };
  TransactionAuthorized: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
  TransactionDeclined: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
  TransactionProcessed: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
}>;
