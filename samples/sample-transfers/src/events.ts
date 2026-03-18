import { DefineEvents } from "@noddde/core";

export type AccountEvent = DefineEvents<{
  AccountOpened: { owner: string };
  FundsDeposited: { amount: number };
  FundsWithdrawn: { amount: number };
  WithdrawalRejected: { amount: number; reason: string };
}>;
