import type { Event, EventBus } from "@noddde/core";
import amqplib from "amqplib";

/** Async-capable event handler matching EventEmitterEventBus's on() signature. */
// eslint-disable-next-line no-unused-vars
type AsyncEventHandler = (event: Event) => void | Promise<void>;

/**
 * RabbitMQ-backed {@link EventBus} implementation.
 *
 * Uses a topic exchange for event routing: each event name is a routing key.
 * Handlers registered via {@link on} create dedicated queues bound to
 * the corresponding routing key.
 *
 * Implements the same `on()` method as `EventEmitterEventBus` so the
 * domain engine can register projection and saga subscriptions.
 *
 * @example
 * ```ts
 * const bus = new RabbitMQEventBus("amqp://localhost");
 * await bus.connect();
 * bus.on("BookingCreated", async (event) => { ... });
 * await bus.dispatch({ name: "BookingCreated", payload: { ... } });
 * await bus.disconnect();
 * ```
 */
export class RabbitMQEventBus implements EventBus {
  private connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  private publishChannel: Awaited<
    ReturnType<Awaited<ReturnType<typeof amqplib.connect>>["createChannel"]>
  > | null = null;
  private readonly exchangeName = "noddde.events";
  private readonly handlers = new Map<string, AsyncEventHandler[]>();
  private readonly consumerChannels: Array<
    Awaited<
      ReturnType<Awaited<ReturnType<typeof amqplib.connect>>["createChannel"]>
    >
  > = [];
  private queueCounter = 0;

  // eslint-disable-next-line no-unused-vars
  constructor(private readonly connectionUrl: string) {}

  /** Establishes connection and creates the topic exchange. */
  async connect(): Promise<void> {
    this.connection = await amqplib.connect(this.connectionUrl);
    this.publishChannel = await this.connection.createChannel();
    await this.publishChannel.assertExchange(this.exchangeName, "topic", {
      durable: false,
    });

    // Set up consumers for any handlers registered before connect()
    for (const [eventName, handlers] of this.handlers) {
      for (const handler of handlers) {
        await this.bindConsumer(eventName, handler);
      }
    }
  }

  /** Closes all channels and the connection. */
  async disconnect(): Promise<void> {
    for (const channel of this.consumerChannels) {
      await channel.close().catch(() => {});
    }
    this.consumerChannels.length = 0;
    await this.publishChannel?.close().catch(() => {});
    this.publishChannel = null;
    await this.connection?.close().catch(() => {});
    this.connection = null;
  }

  /**
   * Registers an event handler. If already connected, immediately
   * creates a consumer queue. Otherwise, queued for when connect() is called.
   */
  on(eventName: string, handler: AsyncEventHandler): void {
    const existing = this.handlers.get(eventName);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventName, [handler]);
    }

    // If already connected, bind immediately
    if (this.connection) {
      this.bindConsumer(eventName, handler).catch(console.error);
    }
  }

  /**
   * Publishes an event to the topic exchange using the event name
   * as the routing key.
   */
  async dispatch<TEvent extends Event>(event: TEvent): Promise<void> {
    if (!this.publishChannel) {
      throw new Error("RabbitMQEventBus: not connected. Call connect() first.");
    }

    const message = Buffer.from(JSON.stringify(event));
    this.publishChannel.publish(this.exchangeName, event.name, message, {
      contentType: "application/json",
    });
  }

  private async bindConsumer(
    eventName: string,
    handler: AsyncEventHandler,
  ): Promise<void> {
    if (!this.connection) return;

    const channel = await this.connection.createChannel();
    this.consumerChannels.push(channel);

    this.queueCounter++;
    const queueName = `noddde.${eventName}.${this.queueCounter}`;
    await channel.assertQueue(queueName, { durable: false, autoDelete: true });
    await channel.bindQueue(queueName, this.exchangeName, eventName);

    await channel.consume(queueName, async (msg: any) => {
      if (!msg) return;
      try {
        const event = JSON.parse(msg.content.toString()) as Event;
        await handler(event);
        channel.ack(msg);
      } catch (error) {
        channel.nack(msg, false, false);
      }
    });
  }
}
