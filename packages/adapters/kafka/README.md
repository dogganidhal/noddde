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
