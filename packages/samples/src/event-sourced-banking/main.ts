import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/core";
import { BankAccount } from "./aggregate";
import {
  BankingInfrastructure,
  ConsoleLogger,
  InMemoryBankAccountViewRepository,
  InMemoryTransactionViewRepository,
} from "./infrastructure";
import { BankAccountCommands } from "./commands";
import { BankAccount as BankAccountProjection } from "./projection";

const main = async () => {
  const domain = await configureDomain<BankingInfrastructure>({
    writeModel: {
      aggregates: {
        BankAccount,
      },
    },
    readModel: {
      projections: {
        BankAccount: BankAccountProjection,
      },
    },
    infrastructure: {
      aggregatePersistence: () =>
        new InMemoryEventSourcedAggregatePersistence(),
      provideInfrastructure: () => ({
        logger: new ConsoleLogger(),
        bankAccountViewRepository: new InMemoryBankAccountViewRepository(),
        transactionViewRepository: new InMemoryTransactionViewRepository(),
      }),
      cqrsInfrastructure: () => ({
        commandBus: new InMemoryCommandBus(),
        eventBus: new EventEmitterEventBus(),
        queryBus: new InMemoryQueryBus(),
      }),
    },
  });

  const bankAccountId = await domain.dispatchCommand({
    name: BankAccountCommands.CreateBankAccount,
  });

  await domain.dispatchCommand({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: +100,
      merchant: "Internal transfer",
    },
  });
  await domain.dispatchCommand({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: -50,
      merchant: "Amazon",
    },
  });
  await domain.dispatchCommand({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: -60,
      merchant: "Fnac",
    },
  });
};

main();
