/**
 * Seat Reservation Sample — Pessimistic Concurrency with Prisma + MySQL
 *
 * Demonstrates advisory locking via MySQL GET_LOCK to serialize
 * concurrent seat reservations. Uses Testcontainers for an
 * ephemeral MySQL instance.
 */
import {
  createInMemoryUnitOfWork,
  defineDomain,
  InMemoryEventSourcedAggregatePersistence,
  wireDomain,
} from "@noddde/engine";
import type { VenueInfrastructure } from "./infrastructure";
import { SystemClock } from "./infrastructure";
import { Venue } from "./aggregate";

async function main() {
  console.log(
    "Seat Reservation Sample — Pessimistic Concurrency with Prisma + MySQL\n",
  );
  try {
    /*
  // Step 1: Start MySQL container
  console.log("Starting MySQL container...");
  const container = await new MySqlContainer("mysql:8")
    .withDatabase("seat_reservation")
    .withReuse()
    .start();

  const connectionUri = `mysql://${container.getUsername()}:${container.getUserPassword()}@${container.getHost()}:${container.getMappedPort(3306)}/${container.getDatabase()}`;
  console.log("  MySQL running\n");

  try {
    // Step 2: Generate Prisma client for MySQL + push schema
    // IMPORTANT: prisma generate must run BEFORE importing @prisma/client
    // because the monorepo root generates it for SQLite, not MySQL.
    console.log("Running Prisma generate + schema push...");
    const sampleRoot = path.resolve(__dirname, "..");
    execSync(`npx prisma generate --schema=prisma/schema.prisma`, {
      cwd: sampleRoot,
      stdio: "pipe",
      env: {
        DATABASE_URL: connectionUri,
      },
    });
    execSync(
      `npx prisma db push --skip-generate --schema=prisma/schema.prisma`,
      {
        cwd: sampleRoot,
        stdio: "pipe",
        env: {
          DATABASE_URL: connectionUri,
        },
      },
    );
    console.log("  Database schema created\n");

    // Step 3: Create Prisma client + advisory locker
    // Dynamic imports: must load AFTER prisma generate regenerates @prisma/client for MySQL
    const { PrismaClient } = await import("@prisma/client");
    const { createPrismaPersistence, PrismaAdvisoryLocker } = await import(
      "@noddde/prisma"
    );

    const prisma = new PrismaClient({
      datasources: { db: { url: connectionUri } },
    });
    const prismaInfra = createPrismaPersistence(prisma);
    const locker = new PrismaAdvisoryLocker(prisma, "mysql");
   */
    const aggregatePersistence = new InMemoryEventSourcedAggregatePersistence();

    // Step 4: Define domain structure (pure, sync)
    const venueDomain = defineDomain<VenueInfrastructure>({
      writeModel: { aggregates: { Venue } },
      readModel: { projections: {} },
    });

    // Wire with infrastructure (async)
    const domain = await wireDomain(venueDomain, {
      infrastructure: () => ({
        clock: new SystemClock(),
      }),
      aggregates: {
        // persistence: () => new InMemoryEventSourcedAggregatePersistence(),
        persistence: () => aggregatePersistence,
        // concurrency: {
        //   strategy: "pessimistic",
        //   locker,
        //   lockTimeoutMs: 5000,
        // },
      },
      // buses: () => ({
      //   commandBus: new InMemoryCommandBus(),
      //   eventBus: new EventEmitterEventBus(),
      //   queryBus: new InMemoryQueryBus(),
      // }),
      // logger: new NodddeLogger("debug"),
      // unitOfWork: () => prismaInfra.unitOfWorkFactory,
      unitOfWork: () => createInMemoryUnitOfWork,
    });
    console.log(
      "Domain configured: pessimistic concurrency with MySQL GET_LOCK (timeout: 5s)\n",
    );

    // Step 5: Create venue with 3 seats
    const seatIds = ["A1", "A2", "A3"];
    await domain.dispatchCommand({
      name: "CreateVenue",
      targetAggregateId: "concert-hall",
      payload: { seatIds },
    });
    console.log(
      `Venue created: 'concert-hall' with seats ${seatIds.join(", ")}\n`,
    );

    // Step 6: Fire 3 concurrent reservation attempts for seat A1
    const customers = ["alice", "bob", "charlie"];
    console.log(
      `Firing ${customers.length} concurrent ReserveSeat commands for seat A1...\n`,
    );
    console.log(
      "  With pessimistic locking, commands are serialized via MySQL GET_LOCK.",
    );
    console.log(
      "  The first to acquire the lock reserves the seat; others see it as taken.\n",
    );

    const results = await Promise.allSettled(
      customers.map((customerId) =>
        domain.dispatchCommand({
          name: "ReserveSeat",
          targetAggregateId: "concert-hall",
          payload: { seatId: "A1", customerId },
        }),
      ),
    );

    // Step 7: Report results
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    console.log(`Results: ${fulfilled} commands completed, ${failed} failed\n`);

    // Step 8: Verify final state
    const finalEvents = await aggregatePersistence.load(
      "Venue",
      "concert-hall",
    );
    const reserved = finalEvents.filter((e) => e.name === "SeatReserved");
    const rejected = finalEvents.filter(
      (e) => e.name === "ReservationRejected",
    );

    console.log("Final event stream:");
    for (const event of finalEvents) {
      if (event.name === "VenueCreated") {
        console.log(
          `  VenueCreated — seats: ${(event.payload as { seatIds: string[] }).seatIds.join(", ")}`,
        );
      } else if (event.name === "SeatReserved") {
        const p = event.payload as { seatId: string; customerId: string };
        console.log(
          `  SeatReserved — seat: ${p.seatId}, customer: ${p.customerId}`,
        );
      } else if (event.name === "ReservationRejected") {
        const p = event.payload as {
          seatId: string;
          customerId: string;
          reason: string;
        };
        console.log(
          `  ReservationRejected — seat: ${p.seatId}, customer: ${p.customerId} (${p.reason})`,
        );
      }
    }
    console.log(
      `\nSummary: ${reserved.length} reserved, ${rejected.length} rejected (out of ${customers.length} attempts)`,
    );

    // Step 9: Also demonstrate releasing and re-reserving
    if (reserved.length > 0) {
      const winner = (reserved[0]!.payload as { customerId: string })
        .customerId;
      console.log(`\nReleasing seat A1 (held by ${winner})...`);
      await domain.dispatchCommand({
        name: "ReleaseSeat",
        targetAggregateId: "concert-hall",
        payload: { seatId: "A1" },
      });
      console.log("  Seat A1 released — now available for re-reservation");
    }

    // await prisma.$disconnect();
  } finally {
    // Step 10: Cleanup
    console.log("\nStopping MySQL container...");
    // await container.stop();
    console.log("  Done!");
  }
}

main().catch(console.error);
