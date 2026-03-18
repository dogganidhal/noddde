import { DefineCommands } from "@noddde/core";

export type AccountCommand = DefineCommands<{
  OpenAccount: { owner: string };
  Deposit: { amount: number };
  Withdraw: { amount: number };
}>;
