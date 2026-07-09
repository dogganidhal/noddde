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
  exchangeName: "my-domain-events",
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
  exchangeName: "my-domain-events",
  queuePrefix: "my-service", // Queues are named "${queuePrefix}.${eventName}"
  prefetchCount: 10, // Backpressure control
  resilience: {
    maxAttempts: 5, // Retry the initial connection up to 5 times
    initialDelayMs: 1000, // Base delay in ms (exponential backoff)
    maxDelayMs: 30000,
  },
});
```

## Troubleshooting

### Changing `exchangeType` after deployment

`exchangeType` (`"topic"` | `"fanout"`) is sticky once the exchange has been created on the broker — RabbitMQ exchanges are immutable, so `assertExchange` fails with `PRECONDITION_FAILED` if you ask for a different type on an exchange that already exists with a different one. This surfaces both on initial `connect()` and on any later reconnect.

If you need to change `exchangeType` for an existing deployment, pick one of:

- Delete the existing exchange manually (e.g. via the RabbitMQ management UI or `rabbitmqadmin delete exchange name=<exchangeName>`) before deploying the new `exchangeType`. Note this drops any bindings on that exchange.
- Configure a new `exchangeName` instead of reusing the old one, so the adapter creates a fresh exchange with the new type.

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
