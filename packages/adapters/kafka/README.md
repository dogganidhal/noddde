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
- Explicit `warmup()` path (and `warmupOnConnect` option) to absorb broker cold-start latency

## Usage

```typescript
import { KafkaEventBus } from "@noddde/kafka";
import { wireDomain } from "@noddde/engine";

const eventBus = new KafkaEventBus({
  brokers: ["localhost:9092"],
  clientId: "my-service",
  groupId: "my-service-group",
});

await eventBus.connect();

const domain = await wireDomain(definition, {
  eventBus,
});

// Clean shutdown
await eventBus.close();
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

### Cold-start warmup

A freshly-deployed Kafka cluster is slow on its **first** end-to-end publish/consume cycle: topic auto-creation, leader election, and ISR sync all happen lazily on first use, so the first message can take far longer to be delivered than every message after it. `connect()` waits for the consumer to start polling (via kafkajs `FETCH_START`) but does not cover this broker-side cold start.

`KafkaEventBus` exposes an explicit warmup path to absorb that latency before real traffic flows. `warmup()` runs a throwaway publish/consume round-trip on a dedicated internal topic (named from `clientId`) and resolves only once the round-trip is observed:

```typescript
await eventBus.connect();
await eventBus.warmup(); // resolves once the broker has served a full round-trip
```

`warmup()` must be called after `connect()`. It is idempotent — after the first successful call, subsequent calls resolve immediately without repeating the round-trip, and concurrent calls are deduplicated into a single round-trip. It rejects with a timeout error if the round-trip does not complete within `warmupTimeoutMs` (default `60000`).

To fold the warmup into connection, set `warmupOnConnect: true` so a single `await connect()` returns a fully warmed bus. Any warmup failure then propagates through `connect()`'s returned promise:

```typescript
const eventBus = new KafkaEventBus({
  brokers: ["localhost:9092"],
  clientId: "my-service",
  groupId: "my-service-group",
  warmupOnConnect: true, // run warmup() as part of connect()
  warmupTimeoutMs: 60000, // optional — round-trip timeout (default 60000)
});

await eventBus.connect(); // only resolves once the broker is warm
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
