# @noddde/rabbitmq

RabbitMQ event bus adapter for noddde. Provides distributed event publishing and subscription with at-least-once delivery guarantees.

**[Documentation](https://noddde.dev)** | **[GitHub](https://github.com/dogganidhal/noddde)**

## Install

```bash
yarn add @noddde/rabbitmq amqplib
# or
npm install @noddde/rabbitmq amqplib
```

## What's Inside

- **`RabbitMqEventBus`** &mdash; Exchange-based event publishing with topic routing, durable queues, manual acknowledgment, and exponential backoff reconnection
- Prefetch-based backpressure control
- Configurable retry policies per handler

## Usage

```typescript
import { RabbitMqEventBus } from "@noddde/rabbitmq";
import { wireDomain } from "@noddde/engine";

const eventBus = new RabbitMqEventBus({
  url: "amqp://localhost:5672",
  exchange: "my-domain-events",
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
const eventBus = new RabbitMqEventBus({
  url: "amqp://localhost:5672",
  exchange: "my-domain-events",
  queue: "my-service", // Consumer queue name
  prefetch: 10, // Backpressure control
  resilience: {
    maxRetries: 5,
    retryDelay: 1000, // Base delay in ms (exponential backoff)
  },
});
```

## Peer Dependencies

- `amqplib` >= 0.10.0

## Related Packages

| Package                                                          | Description                                 |
| :--------------------------------------------------------------- | :------------------------------------------ |
| [`@noddde/core`](https://www.npmjs.com/package/@noddde/core)     | Types, interfaces, and definition functions |
| [`@noddde/engine`](https://www.npmjs.com/package/@noddde/engine) | Runtime engine with domain orchestration    |
| [`@noddde/nats`](https://www.npmjs.com/package/@noddde/nats)     | NATS event bus adapter                      |
| [`@noddde/kafka`](https://www.npmjs.com/package/@noddde/kafka)   | Kafka event bus adapter                     |

## License

MIT
