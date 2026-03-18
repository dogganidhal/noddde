import { defineAggregate } from "@noddde/core";
import type { Infrastructure } from "@noddde/core";
import type { AccountCommand } from "./commands";
import type { AccountEvent } from "./events";

export interface AccountState {
  owner: string | null;
  balance: number;
}

type AccountDef = {
  state: AccountState;
  events: AccountEvent;
  commands: AccountCommand;
  infrastructure: Infrastructure;
};

export const Account = defineAggregate<AccountDef>({
  initialState: { owner: null, balance: 0 },

  commands: {
    OpenAccount: (command) => ({
      name: "AccountOpened",
      payload: { owner: command.payload.owner },
    }),

    Deposit: (command) => ({
      name: "FundsDeposited",
      payload: { amount: command.payload.amount },
    }),

    Withdraw: (command, state) => {
      if (state.balance < command.payload.amount) {
        throw new Error(
          `Insufficient funds: balance is ${state.balance}, ` +
            `attempted to withdraw ${command.payload.amount}`,
        );
      }
      return {
        name: "FundsWithdrawn",
        payload: { amount: command.payload.amount },
      };
    },
  },

  apply: {
    AccountOpened: (payload, state) => ({
      ...state,
      owner: payload.owner,
    }),
    FundsDeposited: (payload, state) => ({
      ...state,
      balance: state.balance + payload.amount,
    }),
    FundsWithdrawn: (payload, state) => ({
      ...state,
      balance: state.balance - payload.amount,
    }),
    WithdrawalRejected: (_payload, state) => state,
  },
});
