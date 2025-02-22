import { BankAccountState } from "./aggregate";
import { Event, StatefulEventHandler } from "@noddde/core";
import { BankingInfrastructure } from "./infrastructure";

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

export type BankAccountEvent =
  | BankAccountCreatedEvent
  | TransactionAuthorizedEvent
  | TransactionDeclinedEvent
  | TransactionProcessedEvent;

export const bankAccountCreatedEventHandler: StatefulEventHandler<
  BankAccountCreatedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state, { logger }) => {
  logger.info(`Bank account ${event.id} created`);
};

export const transactionAuthorizedEventHandler: StatefulEventHandler<
  TransactionAuthorizedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state, { logger }) => {
  logger.info(`Transaction ${event.id} authorized`);
};

export const transactionDeclinedEventHandler: StatefulEventHandler<
  TransactionDeclinedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state, { logger }) => {
  logger.warn(`Transaction ${event.id} declined`);
};

export const transactionProcessedEventHandler: StatefulEventHandler<
  TransactionProcessedEvent,
  BankAccountState,
  BankingInfrastructure
> = (event, state, { logger }) => {
  logger.info(`Transaction ${event.id} processed`);
};
