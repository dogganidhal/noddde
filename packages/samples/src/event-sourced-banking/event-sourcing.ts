import { BankAccount, BankAccountState } from "./aggregate";
import { EventSourcingHandler } from "@noddde/core";
import {
  BankAccountCreatedEvent,
  TransactionAuthorizedEvent,
  TransactionDeclinedEvent,
  TransactionProcessedEvent,
} from "./events";
import { BankingInfrastructure } from "./infrastructure";

export const bankAccountCreatedEventSourcingHandler: EventSourcingHandler<
  BankAccountCreatedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event) => ({
  id: event.id,
  balance: 0,
  availableBalance: 0,
  transactions: [],
});

export const transactionAuthorizedEventSourcingHandler: EventSourcingHandler<
  TransactionAuthorizedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state) => ({
  ...state,
  availableBalance: state.availableBalance - event.amount,
  transactions: [
    ...state.transactions,
    {
      id: event.id,
      timestamp: event.timestamp,
      amount: event.amount,
      merchant: event.merchant,
      status: "pending",
    },
  ],
});

export const transactionDeclinedEventSourcingHandler: EventSourcingHandler<
  TransactionDeclinedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state) => ({
  ...state,
  transactions: [
    ...state.transactions,
    {
      id: event.id,
      timestamp: event.timestamp,
      amount: event.amount,
      merchant: event.merchant,
      status: "declined",
    },
  ],
});

export const transactionProcessedEventSourcingHandler: EventSourcingHandler<
  TransactionProcessedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state) => ({
  ...state,
  balance: state.balance - event.amount,
  transactions: state.transactions.map((transaction) =>
    transaction.id === event.id
      ? {
          ...transaction,
          status: "processed",
        }
      : transaction,
  ),
});
