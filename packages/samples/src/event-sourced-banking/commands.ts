import { BankAccount } from "./aggregate";
import { BankAccountEvents } from "./events";
import { RoutedCommandHandler } from "@noddde/core";

export enum BankAccountCommands {
  CreateBankAccount = "CreateBankAccount",
  AuthorizeTransaction = "AuthorizeTransaction",
}

export interface CreateBankAccountCommand {
  name: BankAccountCommands.CreateBankAccount;
}

export interface AuthorizeTransactionCommand {
  name: BankAccountCommands.AuthorizeTransaction;
  targetAggregateId: string;
  payload: {
    amount: number;
    merchant: string;
  };
}

export const createBankAccountCommandHandler: RoutedCommandHandler<
  CreateBankAccountCommand,
  typeof BankAccount
> = async (_, { eventBus }) => {
  const id = "00000000-0000-0000-0000-000000000000";

  await eventBus.dispatch({
    name: BankAccountEvents.BankAccountCreated,
    payload: {
      id,
    },
  });

  return id;
};

export const authorizeTransactionCommandHandler: RoutedCommandHandler<
  AuthorizeTransactionCommand,
  typeof BankAccount
> = async (command, state, { eventBus }) => {
  if (state.balance < command.amount) {
    await eventBus.dispatch({
      name: BankAccountEvents.TransactionDeclined,
      payload: {
        id: state.id,
        timestamp: new Date(),
        amount: command.amount,
        merchant: command.merchant,
      },
    });
    return;
  }

  // Do any additional processing here
  await eventBus.dispatch({
    name: BankAccountEvents.TransactionAuthorized,
    payload: {
      id: state.id,
      timestamp: new Date(),
      amount: command.amount,
      merchant: command.merchant,
    },
  });
};
