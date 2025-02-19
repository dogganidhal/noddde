import { BankAccount } from "./aggregate";
import { Event, StatefulEventHandler } from "@noddde/core";

export enum BankAccountEvents {
  BankAccountCreated = "BankAccountCreated",
  TransactionAuthorized = "TransactionAuthorized",
  TransactionDeclined = "TransactionDeclined",
  TransactionProcessed = "TransactionProcessed",
}

export interface BankAccountCreatedEvent extends Event {
  name: BankAccountEvents.BankAccountCreated;
  payload: {
    id: string;
  };
}

export interface TransactionAuthorizedEvent extends Event {
  name: BankAccountEvents.TransactionAuthorized;
  payload: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
}

export interface TransactionDeclinedEvent extends Event {
  name: BankAccountEvents.TransactionDeclined;
  payload: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
}

export interface TransactionProcessedEvent extends Event {
  name: BankAccountEvents.TransactionProcessed;
  payload: {
    id: string;
    timestamp: Date;
    amount: number;
    merchant: string;
  };
}

export const bankAccountCreatedStatefulEventHandler: StatefulEventHandler<
  BankAccountCreatedEvent,
  typeof BankAccount
> = (event, state, { logger }) => {
  logger.info(`Bank account ${event.id} created`);
};

export const transactionAuthorizedStatefulEventHandler: StatefulEventHandler<
  TransactionAuthorizedEvent,
  typeof BankAccount
> = (event, state, { logger }) => {
  logger.info(`Transaction ${event.id} authorized`);
};

export const transactionDeclinedStatefulEventHandler: StatefulEventHandler<
  TransactionDeclinedEvent,
  typeof BankAccount
> = (event, state, { logger }) => {
  logger.warn(`Transaction ${event.id} declined`);
};

export const transactionProcessedStatefulEventHandler: StatefulEventHandler<
  TransactionProcessedEvent,
  typeof BankAccount
> = (event, state, { logger }) => {
  logger.info(`Transaction ${event.id} processed`);
};
