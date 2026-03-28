# Auction Sample

A reference project demonstrating core noddde patterns: aggregates with the Decider pattern, event upcasting for schema evolution, and projections with ViewStore for CQRS queries.

**Stack**: Prisma + SQLite | `@noddde/prisma`

## Quick Start

```bash
yarn install
npx prisma generate          # Generate Prisma client from schema
npx vitest run               # Run all tests
npx tsx src/main.ts           # Run the auction scenario
```

## Domain Overview

The auction domain models a simple auction lifecycle:

1. **Create auction** with item, starting price, and end time
2. **Place bids** with validation (minimum bid, time-based, status-based)
3. **Close auction** to determine the winner

```
(new) ──CreateAuction──> open
open ──PlaceBid──> open (BidPlaced | BidRejected)
open ──CloseAuction──> closed
```

## Write Model

### Auction Aggregate (Event-Sourced)

| Command         | Payload                       | Produces         | Guard                                               |
| --------------- | ----------------------------- | ---------------- | --------------------------------------------------- |
| `CreateAuction` | `item, startingPrice, endsAt` | `AuctionCreated` | —                                                   |
| `PlaceBid`      | `bidderId, amount`            | `BidPlaced`      | Auction open, not expired, amount > current highest |
|                 |                               | `BidRejected`    | Any validation failure (recorded as event)          |
| `CloseAuction`  | —                             | `AuctionClosed`  | —                                                   |

**Key patterns:**

- **Rejection events** (`BidRejected`) — the domain records failed attempts as events, not exceptions
- **No-op apply** — `BidRejected` produces no state change (`(_, state) => state`)
- **Infrastructure injection** — `Clock` injected via the third parameter for time-based validation
- **Event upcasting** — `BidPlaced` v1 (no timestamp) evolved to v2 (with timestamp) via `defineEventUpcasterChain`

### Event Upcasting

The aggregate includes an upcaster chain demonstrating schema evolution:

```ts
const bidPlacedUpcasters = defineEventUpcasterChain<[BidPlacedV1, BidPlacedV2]>(
  [(v1) => ({ ...v1, timestamp: new Date(0) })],
);

export const auctionUpcasters = defineUpcasters<AuctionEvent>({
  BidPlaced: bidPlacedUpcasters,
});
```

Old events stored without a `timestamp` field are automatically upcasted when replayed.

## Read Model

### AuctionSummary Projection

Builds a query-optimized view of auction state, updated as events arrive.

**View:** `{ auctionId, item, currentHighBid, currentLeader, bidCount, status }`

**Query:** `GetAuctionSummary(auctionId)` — returns the current auction summary or null

**View reducers** are extracted to standalone functions following the CLI pattern:

- `onAuctionCreated` — initializes view
- `onBidPlaced` — updates high bid, leader, increments count
- `onAuctionClosed` — sets status to closed

## Persistence — Prisma + SQLite

This sample demonstrates the `@noddde/prisma` adapter:

```ts
import { PrismaClient } from "@prisma/client";
import { createPrismaPersistence } from "@noddde/prisma";

const prisma = new PrismaClient();
const prismaInfra = createPrismaPersistence(prisma);
```

Schema defined in `prisma/schema.prisma` with SQLite as the datasource. Tables are auto-managed by Prisma migrations.

## Framework Features Demonstrated

| Feature                                      | Where                                   |
| -------------------------------------------- | --------------------------------------- |
| `defineAggregate`                            | Auction aggregate with Decider pattern  |
| `defineProjection` + ViewStore               | AuctionSummary with query handler       |
| Event upcasting (`defineEventUpcasterChain`) | BidPlaced v1 to v2                      |
| CQRS typed queries (`DefineQueries`)         | GetAuctionSummary                       |
| Rejection events                             | BidRejected (no-op apply)               |
| Infrastructure injection                     | Clock pattern                           |
| Prisma adapter                               | `createPrismaPersistence` + SQLite      |
| CLI-conformant structure                     | event-model/, write-model/, read-model/ |

## Tests

```
__tests__/
  unit/
    auction-aggregate.test.ts          # testAggregate — command handler validation
    auction-state.test.ts              # evolveAggregate — state reconstruction
    auction-summary-projection.test.ts # testProjection — view reducer correctness
    auction-upcasters.test.ts          # evolveAggregate + upcaster chain
  slice/
    auction-lifecycle.test.ts          # testDomain + stripMetadata — full lifecycle
  metadata/
    auction-metadata.test.ts           # createTestMetadataFactory + stripMetadata
```

## Project Structure

```
src/
  main.ts                                # Bootstrap: Prisma + domain + scenario
  infrastructure/
    index.ts                             # Clock interface + AuctionInfrastructure
  domain/
    domain.ts                            # defineDomain — aggregates + projections
    event-model/
      index.ts                           # AuctionEvent union (DefineEvents)
      auction-created.ts                 # Individual event payload interfaces
      bid-placed.ts
      bid-rejected.ts
      auction-closed.ts
    write-model/
      aggregates/
        auction/
          auction.ts                     # defineAggregate (refs extracted handlers)
          state.ts                       # AuctionState + initialAuctionState
          upcasters.ts                   # BidPlaced v1->v2 upcaster chain
          commands/                      # One file per command payload
          command-handlers/              # One file per handler (standalone fn)
    read-model/
      projections/
        auction-summary/
          index.ts                       # defineProjection
          auction-summary.ts             # AuctionSummaryView type
          queries/                       # Query payload + result types
          query-handlers/                # Standalone query handler functions
          view-reducers/                 # Standalone reduce functions
prisma/
  schema.prisma                          # Prisma schema (SQLite)
```
