import { DefineCommands } from "@noddde/core";

export type BankAccountCommand = DefineCommands<{
  CreateBankAccount: void;
  AuthorizeTransaction: { amount: number; merchant: string };
}>;
