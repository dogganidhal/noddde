/* eslint-disable no-unused-vars */
import type {
  OutboxStore,
  EventBus,
  BackgroundProcess,
  Logger,
} from "@noddde/core";

/**
 * Configuration options for the OutboxRelay.
 */
export interface OutboxRelayOptions {
  /** Polling interval in milliseconds. Defaults to 1000. */
  pollIntervalMs?: number;
  /** Maximum entries to process per batch. Defaults to 100. */
  batchSize?: number;
}

/**
 * Background process that polls the {@link OutboxStore} for unpublished
 * entries and dispatches them via the {@link EventBus}. Provides
 * at-least-once delivery guarantees for domain events.
 *
 * If the node crashes after database commit but before event publishing,
 * the relay picks up unpublished entries on restart.
 *
 * Created and managed by the Domain. Not exported to consumers directly
 * (but exported from `@noddde/engine` for testing).
 */
export class OutboxRelay implements BackgroundProcess {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private _drained = false;

  constructor(
    private readonly outboxStore: OutboxStore,
    private readonly eventBus: EventBus,
    private readonly options: OutboxRelayOptions = {},
    private readonly logger?: Logger,
  ) {}

  /**
   * Start polling for unpublished entries.
   * Idempotent: calling start() when already running is a no-op.
   */
  start(): void {
    if (this.timer !== null) return;
    const interval = this.options.pollIntervalMs ?? 1000;
    this.timer = setInterval(() => {
      void this.processOnce();
    }, interval);
  }

  /**
   * Stop polling.
   * Idempotent: calling stop() when not running is a no-op.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Stops polling and processes remaining unpublished entries until
   * the outbox is empty. Implements {@link BackgroundProcess.drain}.
   *
   * Idempotent: subsequent calls resolve immediately.
   */
  async drain(): Promise<void> {
    if (this._drained) return;
    this._drained = true;
    this.stop();

    // Process remaining entries until empty
    let processed: number;
    do {
      processed = await this.processOnce();
    } while (processed > 0);
  }

  /**
   * Process one batch of unpublished entries.
   * Loads entries, dispatches each via EventBus, marks each published.
   * Returns the number of entries successfully dispatched.
   */
  async processOnce(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    try {
      const batchSize = this.options.batchSize ?? 100;
      this.logger?.debug("Polling outbox.", { batchSize });
      const entries = await this.outboxStore.loadUnpublished(batchSize);
      if (entries.length === 0) return 0;

      this.logger?.debug("Outbox entries loaded.", { count: entries.length });
      let dispatched = 0;
      for (const entry of entries) {
        try {
          await this.eventBus.dispatch(entry.event);
          await this.outboxStore.markPublished([entry.id]);
          dispatched++;
        } catch {
          this.logger?.warn("Outbox entry dispatch failed, will retry.", {
            entryId: entry.id,
          });
        }
      }
      if (dispatched > 0) {
        this.logger?.info("Outbox batch processed.", {
          dispatched,
          total: entries.length,
        });
      }
      return dispatched;
    } finally {
      this.processing = false;
    }
  }
}
