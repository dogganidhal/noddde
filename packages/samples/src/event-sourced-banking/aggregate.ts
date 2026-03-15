import { defineAggregate } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";
import { BankAccountCommand } from "./commands";
import { BankAccountEvent } from "./events";

export interface BankAccountState {
  balance: number;
  availableBalance: number;
  transactions: Array<{
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
    status: "pending" | "processed" | "declined";
  }>;
}

type BankAccountDef = {
  state: BankAccountState;
  events: BankAccountEvent;
  commands: BankAccountCommand;
  infrastructure: BankingInfrastructure;
};

export const BankAccount = defineAggregate<BankAccountDef>({
  initialState: {
    balance: 0,
    availableBalance: 0,
    transactions: [],
  },

  commands: {
    CreateBankAccount: (command, _state, { logger }) => {
      logger.info(`Creating bank account ${command.targetAggregateId}`);
      return {
        name: "BankAccountCreated",
        payload: { id: command.targetAggregateId },
      };
    },

    AuthorizeTransaction: (command, state, { logger }) => {
      const { amount, merchant } = command.payload;

      if (state.availableBalance < amount) {
        logger.warn(`Transaction declined for ${merchant}: insufficient funds`);
        return {
          name: "TransactionDeclined",
          payload: {
            id: command.targetAggregateId,
            timestamp: new Date(),
            amount,
            merchant,
          },
        };
      }

      logger.info(`Transaction authorized: ${amount} at ${merchant}`);
      return {
        name: "TransactionAuthorized",
        payload: {
          id: command.targetAggregateId,
          timestamp: new Date(),
          amount,
          merchant,
        },
      };
    },
  },

  apply: {
    BankAccountCreated: (_event, _state) => ({
      balance: 0,
      availableBalance: 0,
      transactions: [],
    }),

    TransactionAuthorized: (event, state) => ({
      ...state,
      availableBalance: state.availableBalance - event.amount,
      transactions: [
        ...state.transactions,
        {
          id: event.id,
          timestamp: event.timestamp,
          amount: event.amount,
          merchant: event.merchant,
          status: "pending" as const,
        },
      ],
    }),

    TransactionDeclined: (event, state) => ({
      ...state,
      transactions: [
        ...state.transactions,
        {
          id: event.id,
          timestamp: event.timestamp,
          amount: event.amount,
          merchant: event.merchant,
          status: "declined" as const,
        },
      ],
    }),

    TransactionProcessed: (event, state) => ({
      ...state,
      balance: state.balance - event.amount,
      transactions: state.transactions.map((transaction) =>
        transaction.id === event.id
          ? { ...transaction, status: "processed" as const }
          : transaction,
      ),
    }),
  },
});
