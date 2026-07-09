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

## Troubleshooting

### Cold-start latency on freshly-deployed clusters

`connect()` waits for the consumer's `FETCH_START` event, which guarantees the consumer is actively polling before `connect()` resolves. That only covers consumer-side readiness. On a brand-new Kafka cluster (e.g. a fresh broker in CI, or a first-ever deployment), the _broker's_ first end-to-end publish/consume round trip can be dramatically slower than subsequent ones — slow enough to exceed a typical 30s delivery expectation.

This is a one-shot cold-start cost, not an ongoing issue: once a topic/partition has been touched once, later publishes are fast. If your application (or its tests) can't tolerate a slow first delivery, warm the cluster up explicitly at startup with a throwaway publish/consume cycle before serving traffic:

```typescript
import { randomUUID } from "node:crypto";
import { Kafka } from "kafkajs";
import { KafkaEventBus } from "@noddde/kafka";

async function warmupKafka(brokers: string[], timeoutMs = 60_000) {
  // Unique per invocation: a shared topic/groupId/clientId across multiple
  // instances or rolling restarts risks one instance's warmup message being
  // consumed by another, or triggering consumer-group rebalances.
  const suffix = randomUUID();
  const warmupTopic = `__warmup_${suffix}`;

  const admin = new Kafka({
    brokers,
    clientId: `warmup-admin-${suffix}`,
  }).admin();
  try {
    await admin.connect();
    await admin.createTopics({
      waitForLeaders: true,
      topics: [{ topic: warmupTopic, numPartitions: 1 }],
    });
  } finally {
    await admin.disconnect();
  }

  const warmupBus = new KafkaEventBus({
    brokers,
    clientId: `warmup-${suffix}`,
    groupId: `warmup-group-${suffix}`,
  });
  let warmedUp = false;
  warmupBus.on(warmupTopic, async () => {
    warmedUp = true;
  });
  await warmupBus.connect();

  try {
    const deadline = Date.now() + timeoutMs;
    while (!warmedUp) {
      if (Date.now() > deadline) {
        throw new Error(`Kafka warmup timed out after ${timeoutMs}ms`);
      }
      await warmupBus.dispatch({ name: warmupTopic, payload: {} });
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await warmupBus.close();
  }
}
```

Run this once at process startup before wiring the real `KafkaEventBus`/domain. The `@noddde/kafka` integration test suite uses the same pattern (unique per-test topic, bounded `waitFor` timeout) in `beforeAll` to avoid flaking on a cold CI cluster.

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
