# @noddde/kafka

Kafka event bus adapter for noddde. Provides scalable event streaming with consumer groups, partition-based ordering, and at-least-once delivery guarantees.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/kafka kafkajs
# or
npm install @noddde/kafka kafkajs
```

## What's Inside

- **`KafkaEventBus`** &mdash; Topic-based event publishing with consumer group fan-out, manual offset commits, configurable partition key strategy, and delivery retry tracking
- Partition key defaults to `aggregateId` for ordered processing per aggregate
- Session timeout and heartbeat configuration

## Usage

```typescript
import { KafkaEventBus } from "@noddde/kafka";
import { wireDomain } from "@noddde/engine";

const eventBus = new KafkaEventBus({
  brokers: ["localhost:9092"],
  clientId: "my-service",
  groupId: "my-service-group",
});

// Do NOT call connect() yourself here: wireDomain() registers every event
// handler via on() first, then auto-connects the bus. See "Subscribe before
// connect()" below — subscriptions can only be established while the consumer
// is not yet running.
const domain = await wireDomain(definition, {
  eventBus,
});

// Clean shutdown
await eventBus.close();
```

### Subscribe before connect()

Kafka does not allow subscribing to a new topic on a consumer that is already
running (`kafkajs` throws `Cannot subscribe to topic while consumer is
running`). `KafkaEventBus` therefore only establishes subscriptions during
`connect()`, from the set of handlers registered with `on()` up to that point.

- **Register all handlers with `on()` before calling `connect()`.** When you
  use `wireDomain()`, this happens automatically — it wires every handler and
  then connects the bus for you, so you should not call `connect()` yourself.
- Calling `on()` **after** `connect()` for an event whose topic is not already
  subscribed **throws** immediately, rather than silently dropping the
  handler's messages. Registering an additional handler for an
  already-subscribed event is always allowed (in-process fan-out).

If you construct the bus manually, connect only after all `on()` calls:

```typescript
eventBus.on("AccountCreated", handleAccountCreated);
eventBus.on("AccountClosed", handleAccountClosed);
await eventBus.connect(); // subscriptions activate here
```

### Configuration

```typescript
const eventBus = new KafkaEventBus({
  brokers: ["localhost:9092"],
  clientId: "my-service",
  groupId: "my-service-group",
  topicPrefix: "myapp", // Optional topic namespace
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  resilience: {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
  },
});
```

## Peer Dependencies

- `kafkajs` >= 2.0.0

## Related Packages

| Package                                                              | Description                                 |
| :------------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)         | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)     | Runtime engine with domain orchestration    |
| [`@noddde/rabbitmq`](https://www.npmjs.com/package/@noddde/rabbitmq) | RabbitMQ event bus adapter                  |
| [`@noddde/nats`](https://www.npmjs.com/package/@noddde/nats)         | NATS event bus adapter                      |

## License

MIT
