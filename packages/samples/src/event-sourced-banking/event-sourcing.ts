import { BankAccount } from "./aggregate";
import { EventSourcingHandler } from "@noddde/core";
import {
  BankAccountCreatedEvent,
  TransactionAuthorizedEvent,
  TransactionDeclinedEvent,
  TransactionProcessedEvent,
} from "./events";

export const bankAccountCreatedEventSourcingHandler: EventSourcingHandler<
  BankAccountCreatedEvent,
  typeof BankAccount
> = (event) => ({
  id: event.id,
  balance: 0,
  availableBalance: 0,
  transactions: [],
});

export const transactionAuthorizedEventSourcingHandler: EventSourcingHandler<
  TransactionAuthorizedEvent,
  typeof BankAccount
> = (event, state) => ({
  ...state,
  availableBalance: state.availableBalance - event.amount,
});

export const transactionDeclinedEventSourcingHandler: EventSourcingHandler<
  TransactionDeclinedEvent,
  typeof BankAccount
> = (event, state) => state;

export const transactionProcessedEventSourcingHandler: EventSourcingHandler<
  TransactionProcessedEvent,
  typeof BankAccount
> = (event, state) => ({
  ...state,
  balance: state.balance - event.amount,
});
