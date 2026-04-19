# @noddde/nats

NATS event bus adapter for noddde. Provides high-performance distributed event publishing and subscription using JetStream with at-least-once delivery guarantees.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/nats nats
# or
npm install @noddde/nats nats
```

## What's Inside

- **`NatsEventBus`** &mdash; JetStream-based event publishing with durable consumers, subject-based routing, manual acknowledgment, and consumer group support
- Built-in resilience via NATS native reconnection
- Configurable subject prefix for multi-tenant environments

## Usage

```typescript
import { NatsEventBus } from "@noddde/nats";
import { wireDomain } from "@noddde/engine";

const eventBus = new NatsEventBus({
  servers: "nats://localhost:4222",
  streamName: "my-domain-events",
  consumerGroup: "my-service",
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
const eventBus = new NatsEventBus({
  servers: "nats://localhost:4222",
  streamName: "my-domain-events",
  consumerGroup: "my-service", // Durable consumer group
  subjectPrefix: "myapp", // Optional subject namespace
  resilience: {
    maxAttempts: 5, // -1 for infinite (default)
    initialDelayMs: 2000, // NATS uses fixed intervals — maxDelayMs is ignored
  },
});
```

## Peer Dependencies

- `nats` >= 2.0.0

## Related Packages

| Package                                                              | Description                                 |
| :------------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)         | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine)     | Runtime engine with domain orchestration    |
| [`@noddde/rabbitmq`](https://www.npmjs.com/package/@noddde/rabbitmq) | RabbitMQ event bus adapter                  |
| [`@noddde/kafka`](https://www.npmjs.com/package/@noddde/kafka)       | Kafka event bus adapter                     |

## License

MIT
