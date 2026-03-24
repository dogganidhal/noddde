# Hotel Booking Sample

A comprehensive reference project demonstrating the noddde framework's DDD, CQRS, and Event Sourcing capabilities through a hotel booking domain.

## Quick Start

```bash
yarn install
npx vitest run      # 74 tests (72 pass, 2 skipped — RabbitMQ requires Docker)
npx tsx src/main.ts # Start Fastify server on :3000
```

## Domain Overview

The hotel booking domain models three bounded contexts — room management, booking lifecycle, and inventory tracking — coordinated by three sagas that automate the end-to-end booking flow.

### End-to-End Booking Flow

When a guest creates a booking, the entire flow is automated through saga orchestration:

```
Guest: POST /bookings
  |
  v
[Booking Aggregate] ── BookingCreated ──> [BookingFulfillment Saga]
                                               |
                                               | dispatches RequestPayment
                                               v
[Booking Aggregate] ── PaymentRequested ──> [PaymentProcessing Saga]
                                               |
                                               | calls paymentGateway.charge()
                                               |
                                        success? ──yes──> dispatches CompletePayment
                                           |                     |
                                           no                    v
                                           |        [Booking Aggregate] ── PaymentCompleted
                                           |                     |
                                           |                     v
                                           |        [BookingFulfillment Saga]
                                           |             |
                                           |             | queries SearchAvailableRooms
                                           |             |
                                           |        room found? ──yes──> dispatches ConfirmBooking + ReserveRoom
                                           |             |                     |              |
                                           |             no                    v              v
                                           |             |          [Booking Aggregate]  [Room Aggregate]
                                           |             |          BookingConfirmed      RoomReserved
                                           |             |                |                    |
                                           |             |                v                    v
                                           |             |        [SendBookingConfirmation]  [CheckoutReminder Saga]
                                           |             |          sends email               sends welcome SMS
                                           |             |
                                           |             v
                                           |        dispatches CancelBooking
                                           |          (no room of requested type)
                                           |
                                           v
                                  dispatches FailPayment
                                      |
                                      v
                          [BookingFulfillment Saga]
                            dispatches CancelBooking
```

Everything after `POST /bookings` happens automatically. No manual HTTP calls needed for payment, confirmation, or room assignment.

## Write Model — Aggregates

### Room (Event-Sourced)

Manages physical room lifecycle. Snapshots every 50 events via `everyNEvents(50)` to optimize replay for high-traffic rooms.

**State transitions:**

```
created ──MakeRoomAvailable──> available
available ──ReserveRoom──> reserved
reserved ──CheckInGuest──> occupied
occupied ──CheckOutGuest──> available
[any except occupied] ──PutUnderMaintenance──> maintenance
```

| Command               | Payload                                  | Produces               | Guard                                  |
| --------------------- | ---------------------------------------- | ---------------------- | -------------------------------------- |
| `CreateRoom`          | `roomNumber, type, floor, pricePerNight` | `RoomCreated`          | Room not already created               |
| `MakeRoomAvailable`   | —                                        | `RoomMadeAvailable`    | Not occupied                           |
| `ReserveRoom`         | `bookingId, guestId, checkIn, checkOut`  | `RoomReserved`         | Must be available                      |
| `CheckInGuest`        | `bookingId, guestId`                     | `GuestCheckedIn`       | Must be reserved, bookingId must match |
| `CheckOutGuest`       | `bookingId, guestId`                     | `GuestCheckedOut`      | Must be occupied                       |
| `PutUnderMaintenance` | `reason, estimatedUntil`                 | `RoomUnderMaintenance` | Not occupied                           |

### Booking (Event-Sourced)

Manages booking lifecycle including payment state machine. Uses idempotency for payment commands to prevent double-charging.

**State transitions:**

```
(new) ──CreateBooking──> pending
pending ──RequestPayment──> awaiting_payment
awaiting_payment ──CompletePayment──> awaiting_payment (transactionId set)
awaiting_payment ──FailPayment──> pending (paymentId cleared)
pending|awaiting_payment ──ConfirmBooking──> confirmed
[any except cancelled] ──CancelBooking──> cancelled
```

| Command           | Payload                                             | Produces           | Guard                               |
| ----------------- | --------------------------------------------------- | ------------------ | ----------------------------------- |
| `CreateBooking`   | `guestId, roomType, checkIn, checkOut, totalAmount` | `BookingCreated`   | Not already created                 |
| `RequestPayment`  | `paymentId, amount`                                 | `PaymentRequested` | Must be pending                     |
| `CompletePayment` | `paymentId, transactionId, amount`                  | `PaymentCompleted` | Must be awaiting_payment            |
| `FailPayment`     | `paymentId, reason`                                 | `PaymentFailed`    | Must be awaiting_payment            |
| `ConfirmBooking`  | `roomId`                                            | `BookingConfirmed` | Must be pending or awaiting_payment |
| `CancelBooking`   | `reason`                                            | `BookingCancelled` | Not already cancelled               |
| `ModifyBooking`   | `newCheckIn, newCheckOut, newTotalAmount`           | `BookingModified`  | Not cancelled                       |
| `RefundPayment`   | `paymentId, amount`                                 | `PaymentRefunded`  | Must have transactionId             |

### Inventory (State-Stored)

Tracks room type availability counts. Uses state-stored persistence (not event-sourced) because only current counts matter, not history.

| Command                 | Payload                                            | Produces                  | Guard                   |
| ----------------------- | -------------------------------------------------- | ------------------------- | ----------------------- |
| `InitializeInventory`   | `roomCounts: Record<RoomType, {total, available}>` | `InventoryInitialized`    | Not already initialized |
| `UpdateRoomTypeCount`   | `roomType, total, available`                       | `RoomTypeCountUpdated`    | Must be initialized     |
| `DecrementAvailability` | `roomType`                                         | `AvailabilityDecremented` | Available > 0           |
| `IncrementAvailability` | `roomType`                                         | `AvailabilityIncremented` | Must be initialized     |

## Read Model — Projections

### RoomAvailability (Strong Consistency)

Updated within the same Unit of Work as the command that produced the event. Backed by a Drizzle `ViewStore` persisted to SQLite.

**View:** `{ roomId, roomNumber, type, floor, pricePerNight, status, currentGuestId }`

**Queries:**

- `GetRoomAvailability(roomId)` — single room view
- `ListAvailableRooms(type?)` — all rooms with status `"available"`, optionally filtered by room type

### GuestHistory (Eventual Consistency)

Tracks booking history per guest. Only reacts to `BookingCreated` (the only event carrying `guestId`). Backed by `InMemoryViewStore`.

**View:** `{ guestId, bookings: [{ bookingId, roomType, checkIn, checkOut, status }] }`

**Queries:**

- `GetGuestHistory(guestId)` — full booking history for a guest

### Revenue (Eventual Consistency)

Aggregates daily revenue from completed payments. Keyed by date extracted from `PaymentCompleted.completedAt`. Backed by `InMemoryViewStore`.

**View:** `{ date, totalRevenue, bookingCount }`

**Queries:**

- `GetDailyRevenue(date)` — revenue summary for a specific date

### Standalone Query Handler

- `SearchAvailableRooms(type?, checkIn?, checkOut?)` — reads directly from the `roomAvailabilityViewStore`, filters by status and optional room type

## Process Model — Sagas

### BookingFulfillment Saga

Orchestrates the full booking lifecycle across the Booking and Room aggregates.

| Trigger Event      | Action                              | Commands Dispatched                                                        |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| `BookingCreated`   | Starts saga, initiates payment      | `RequestPayment`                                                           |
| `PaymentCompleted` | Finds available room via `queryBus` | `ConfirmBooking` + `ReserveRoom` (room found) or `CancelBooking` (no room) |
| `PaymentFailed`    | Cancels booking                     | `CancelBooking`                                                            |
| `BookingCancelled` | Refunds if payment was completed    | `RefundPayment` (only if status was `"confirmed"`)                         |
| `BookingConfirmed` | Observation — updates state         | —                                                                          |
| `BookingModified`  | Observation — updates dates/amount  | —                                                                          |
| `PaymentRequested` | Observation                         | —                                                                          |
| `PaymentRefunded`  | Observation — marks cancelled       | —                                                                          |

### PaymentProcessing Saga

Bridges the domain and the payment gateway. Uses a narrow event type (`Extract<BookingEvent, PaymentRequested | PaymentCompleted | PaymentFailed>`) to only subscribe to 3 payment lifecycle events.

| Trigger Event      | Action                                         | Commands Dispatched                                  |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------- |
| `PaymentRequested` | Calls `paymentGateway.charge(guestId, amount)` | `CompletePayment` (success) or `FailPayment` (error) |
| `PaymentCompleted` | Observation — marks completed                  | —                                                    |
| `PaymentFailed`    | Observation — marks failed                     | —                                                    |

### CheckoutReminder Saga

Tracks guest stays and sends SMS notifications. Operates on Room events.

| Trigger Event                                              | Action                         | Commands Dispatched |
| ---------------------------------------------------------- | ------------------------------ | ------------------- |
| `GuestCheckedIn`                                           | Sends welcome SMS              | —                   |
| `GuestCheckedOut`                                          | Sends farewell SMS             | —                   |
| `RoomReserved`                                             | Records expected checkout date | —                   |
| `RoomCreated`, `RoomMadeAvailable`, `RoomUnderMaintenance` | Observation                    | —                   |

## Standalone Handlers

**Event Handlers** (registered on the event bus after domain init):

- `SendBookingConfirmation` — on `BookingConfirmed`, sends email via `emailService`
- `SendCheckInNotification` — on `GuestCheckedIn`, sends SMS via `smsService`

**Command Handler:**

- `RunNightlyAudit` — standalone command not routed to any aggregate, demonstrates custom command handlers

## HTTP API

### Room Endpoints

| Method | Path                            | Description                                                       |
| ------ | ------------------------------- | ----------------------------------------------------------------- |
| `POST` | `/rooms`                        | Create a room. Body: `{ roomNumber, type, floor, pricePerNight }` |
| `POST` | `/rooms/:roomId/make-available` | Mark room as available                                            |
| `POST` | `/rooms/:roomId/reserve`        | Reserve room. Body: `{ bookingId, guestId, checkIn, checkOut }`   |
| `POST` | `/rooms/:roomId/check-in`       | Check in guest. Body: `{ bookingId, guestId }`                    |
| `POST` | `/rooms/:roomId/check-out`      | Check out guest. Body: `{ bookingId, guestId }`                   |
| `POST` | `/rooms/:roomId/maintenance`    | Put under maintenance. Body: `{ reason, estimatedUntil }`         |

### Booking Endpoints

| Method | Path                                    | Description                                                                                                |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST` | `/bookings`                             | Create a booking (triggers full saga chain). Body: `{ guestId, roomType, checkIn, checkOut, totalAmount }` |
| `POST` | `/bookings/:bookingId/confirm`          | Manually confirm. Body: `{ roomId }`                                                                       |
| `POST` | `/bookings/:bookingId/cancel`           | Cancel booking. Body: `{ reason }`                                                                         |
| `POST` | `/bookings/:bookingId/request-payment`  | Manually request payment. Body: `{ amount }`                                                               |
| `POST` | `/bookings/:bookingId/complete-payment` | Manually complete payment. Body: `{ paymentId, transactionId, amount }`                                    |
| `POST` | `/bookings/group`                       | Atomic group booking via UnitOfWork. Body: `{ guestId, rooms: [...] }`                                     |

### Query Endpoints

| Method | Path                           | Description                                   |
| ------ | ------------------------------ | --------------------------------------------- |
| `GET`  | `/rooms/:roomId/availability`  | Get room availability view                    |
| `GET`  | `/rooms/available?type=single` | Search available rooms (optional type filter) |
| `GET`  | `/guests/:guestId/history`     | Get guest booking history                     |
| `GET`  | `/revenue/:date`               | Get daily revenue summary                     |
| `GET`  | `/health`                      | Health check                                  |

### Error Handling

The error handler plugin maps domain errors to HTTP status codes:

- `409 Conflict` — errors containing "already", "cannot", or `ConcurrencyError`
- `404 Not Found` — errors containing "not found"
- `500 Internal Server Error` — everything else

## Infrastructure

### Persistence Configuration

| Aggregate | Strategy      | Backing Store                        |
| --------- | ------------- | ------------------------------------ |
| Room      | Event-sourced | Drizzle + SQLite                     |
| Booking   | Event-sourced | Drizzle + SQLite                     |
| Inventory | State-stored  | Drizzle + SQLite                     |
| Sagas     | State-stored  | Drizzle + SQLite                     |
| Snapshots | Room only     | Drizzle + SQLite, `everyNEvents(50)` |

### Service Implementations

| Service          | Production            | Test                     |
| ---------------- | --------------------- | ------------------------ |
| `Clock`          | `SystemClock`         | `FixedClock`             |
| `EmailService`   | `ConsoleEmailService` | `InMemoryEmailService`   |
| `SmsService`     | `ConsoleSmsService`   | `InMemorySmsService`     |
| `PaymentGateway` | `FakePaymentGateway`  | `InMemoryPaymentGateway` |

### Custom Implementations

- **RabbitMQ EventBus** — `amqplib`-based event bus with topic exchange (requires Docker for tests)
- **Drizzle ViewStore** — generic `ViewStore<T>` backed by a `hotel_views` SQLite table with JSON serialization

## Framework Features Demonstrated

| #   | Feature                         | Where                                                   |
| --- | ------------------------------- | ------------------------------------------------------- |
| 1   | `defineAggregate`               | Room, Booking, Inventory                                |
| 2   | `defineProjection`              | RoomAvailability, GuestHistory, Revenue                 |
| 3   | `defineSaga`                    | BookingFulfillment, PaymentProcessing, CheckoutReminder |
| 4   | Event-sourced persistence       | Room, Booking (via Drizzle)                             |
| 5   | State-stored persistence        | Inventory (via Drizzle)                                 |
| 6   | Per-aggregate persistence       | Mixed strategies in same domain                         |
| 7   | Snapshots                       | Room aggregate, `everyNEvents(50)`                      |
| 8   | Idempotency                     | `InMemoryIdempotencyStore` for payment commands         |
| 9   | Optimistic concurrency          | `{ maxRetries: 3 }`                                     |
| 10  | Strong consistency projection   | RoomAvailability (updated in same UoW)                  |
| 11  | Eventual consistency projection | GuestHistory, Revenue                                   |
| 12  | Standalone event handlers       | `SendBookingConfirmation`, `SendCheckInNotification`    |
| 13  | Standalone command handlers     | `RunNightlyAudit`                                       |
| 14  | Standalone query handlers       | `SearchAvailableRooms`                                  |
| 15  | Unit of Work                    | Group booking (`domain.withUnitOfWork()`)               |
| 16  | MetadataProvider                | AsyncLocalStorage from Fastify HTTP headers             |
| 17  | Custom EventBus                 | RabbitMQ implementation                                 |
| 18  | Custom ViewStore                | Drizzle-backed view store                               |
| 19  | Cross-aggregate saga            | BookingFulfillment dispatches to Booking + Room         |
| 20  | Infrastructure-calling saga     | PaymentProcessing calls `paymentGateway`                |
| 21  | Side-effect saga                | CheckoutReminder calls `smsService`                     |
| 22  | HTTP layer                      | Fastify REST API                                        |
| 23  | `testAggregate` harness         | Unit tests                                              |
| 24  | `testProjection` harness        | Unit tests                                              |
| 25  | `testSaga` harness              | Unit tests                                              |
| 26  | `testDomain` + DomainSpy        | Slice tests                                             |

## Tests

```
__tests__/
  unit/                                    # Isolated component tests
    room-aggregate.test.ts                 # 10 tests — state transitions, guards
    booking-aggregate.test.ts              # 12 tests — payment state machine
    inventory-aggregate.test.ts            # 7 tests — state-stored aggregate
    room-availability-projection.test.ts   # 4 tests — strong consistency view
    guest-history-projection.test.ts       # 2 tests — booking history accumulation
    revenue-projection.test.ts             # 2 tests — daily revenue aggregation
    booking-fulfillment-saga.test.ts       # 7 tests — orchestration + compensation
    payment-processing-saga.test.ts        # 3 tests — gateway charge + error handling
    checkout-reminder-saga.test.ts         # 3 tests — SMS notifications
  slice/                                   # Multi-component integration
    booking-flow.test.ts                   # 3 tests — full lifecycle via testDomain
    cancellation-flow.test.ts              # 3 tests — saga compensation chains
    group-booking.test.ts                  # 2 tests — atomic UoW operations
    idempotency.test.ts                    # 2 tests — duplicate command rejection
  integration/                             # Real DB + HTTP
    http-rooms.test.ts                     # 4 tests — room CRUD via Fastify inject
    http-booking.test.ts                   # 5 tests — end-to-end saga flow via HTTP
    full-stack.test.ts                     # 3 tests — SQLite persistence + metadata
    rabbitmq-event-bus.test.ts             # 2 tests — (skipped, requires Docker)
```

## Project Structure

```
src/
  domain/                          # Pure domain — no I/O dependencies
    write-model/
      room/                        # Event-sourced, snapshots
      booking/                     # Event-sourced, idempotency
      inventory/                   # State-stored
    read-model/
      projections/                 # 3 projections (1 strong, 2 eventual)
      queries.ts                   # View + query type definitions
      query-handlers.ts            # Standalone query handler
    process-model/
      booking-fulfillment.ts       # Cross-aggregate orchestration
      payment-processing.ts        # Payment gateway bridge
      checkout-reminder.ts         # Guest notification workflow
  infrastructure/                  # All I/O and framework wiring
    types.ts                       # HotelInfrastructure + service interfaces
    services/                      # Clock, email, SMS, payment implementations
    persistence/                   # Drizzle schema + custom ViewStore
    messaging/                     # RabbitMQ EventBus
    handlers/                      # Standalone event + command handlers
    http/                          # Fastify app, plugins, routes
  main.ts                          # Bootstrap: DB + Domain + Fastify
```
