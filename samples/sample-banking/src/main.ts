/**
 * Banking Sample — Prisma Adapter
 *
 * Demonstrates @noddde/prisma with SQLite for persistence.
 * A bank account domain with projections and queries.
 */
import {
  defineDomain,
  wireDomain,
  EventEmitterEventBus,
  InMemoryCommandBus,
  InMemoryQueryBus,
} from "@noddde/engine";
import { PrismaClient } from "@prisma/client";
import { createPrismaPersistence } from "@noddde/prisma";
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
  // ── Set up Prisma with SQLite ────────────────────────────────
  const prisma = new PrismaClient();
  const prismaInfra = createPrismaPersistence(prisma);

  // ── Define the domain structure (pure, sync) ─────────────────
  const bankingDomain = defineDomain<BankingInfrastructure>({
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
  });

  // ── Wire with infrastructure (async) ────────────────────────
  const domain = await wireDomain(bankingDomain, {
    infrastructure: () => ({
      clock: new SystemClock(),
      logger: new ConsoleLogger(),
      bankAccountViewRepository: new InMemoryBankAccountViewRepository(),
      transactionViewRepository: new InMemoryTransactionViewRepository(),
    }),
    aggregates: {
      persistence: () => prismaInfra.eventSourcedPersistence,
    },
    buses: () => ({
      commandBus: new InMemoryCommandBus(),
      eventBus: new EventEmitterEventBus(),
      queryBus: new InMemoryQueryBus(),
    }),
    unitOfWork: () => prismaInfra.unitOfWorkFactory,
  });

  // ── Run the banking scenario ─────────────────────────────────
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

  await prisma.$disconnect();
  console.log("✅ Banking sample completed (Prisma + SQLite)");
};

main();
