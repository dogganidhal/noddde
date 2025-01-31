import { configureDomain, InMemoryAggregatePersistence } from "@noddde/core";
import { BankAccount } from "./aggregate";
import { BankingInfrastructure, ConsoleLogger } from "./infrastructure";
import { BankAccountCommands } from "./commands";

const main = async () => {
  const domain = await configureDomain<BankingInfrastructure>({
    aggregates: {
      BankAccount,
    },
    persistence: () => new InMemoryAggregatePersistence(),
    createInfrastructure: () => ({
      logger: new ConsoleLogger(),
    }),
  });

  const bankAccountId = await domain.commandBus.dispatch({
    name: BankAccountCommands.CreateBankAccount,
  });

  await domain.commandBus.dispatch({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: +100,
      merchant: "Internal transfer",
    },
  });
  await domain.commandBus.dispatch({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: -50,
      merchant: "Amazon",
    },
  });
  await domain.commandBus.dispatch({
    name: BankAccountCommands.AuthorizeTransaction,
    payload: {
      targetAggregateId: bankAccountId,
      amount: -60,
      merchant: "Fnac",
    },
  });
};

main();
