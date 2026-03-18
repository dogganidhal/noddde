import {
  configureDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryEventSourcedAggregatePersistence,
  InMemoryQueryBus,
} from "@noddde/engine";
import { BankAccount } from "./aggregate";
import {
  BankingInfrastructure,
  ConsoleLogger,
  InMemoryBankAccountViewRepository,
  InMemoryTransactionViewRepository,
  SystemClock,
} from "./infrastructure";
import { BankAccountProjection } from "./projection";
import { randomUUID } from "crypto";

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
        clock: new SystemClock(),
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

  const bankAccountId = randomUUID();

  await domain.dispatchCommand({
    name: "CreateBankAccount",
    targetAggregateId: bankAccountId,
  });

  await domain.dispatchCommand({
    name: "AuthorizeTransaction",
    targetAggregateId: bankAccountId,
    payload: {
      amount: +100,
      merchant: "Internal transfer",
    },
  });

  await domain.dispatchCommand({
    name: "AuthorizeTransaction",
    targetAggregateId: bankAccountId,
    payload: {
      amount: -50,
      merchant: "Amazon",
    },
  });

  await domain.dispatchCommand({
    name: "AuthorizeTransaction",
    targetAggregateId: bankAccountId,
    payload: {
      amount: -60,
      merchant: "Fnac",
    },
  });
};

main();
