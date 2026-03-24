/* eslint-disable no-unused-vars */
import type { OutboxStore, OutboxEntry } from "@noddde/core";

/**
 * In-memory implementation of {@link OutboxStore}.
 *
 * Uses a `Map<string, OutboxEntry>` keyed by entry ID.
 * Suitable for development, testing, and single-process applications.
 * Not crash-recoverable (state is lost on process exit).
 */
export class InMemoryOutboxStore implements OutboxStore {
  private readonly entries = new Map<string, OutboxEntry>();

  /** @inheritdoc */
  async save(entries: OutboxEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, { ...entry });
    }
  }

  /** @inheritdoc */
  async loadUnpublished(batchSize = 100): Promise<OutboxEntry[]> {
    const unpublished: OutboxEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.publishedAt === null) {
        unpublished.push(entry);
      }
    }
    unpublished.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return unpublished.slice(0, batchSize);
  }

  /** @inheritdoc */
  async markPublished(ids: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry && entry.publishedAt === null) {
        entry.publishedAt = now;
      }
    }
  }

  /** @inheritdoc */
  async markPublishedByEventIds(eventIds: string[]): Promise<void> {
    const idSet = new Set(eventIds);
    const now = new Date().toISOString();
    for (const entry of this.entries.values()) {
      if (
        entry.publishedAt === null &&
        entry.event.metadata?.eventId != null &&
        idSet.has(entry.event.metadata.eventId)
      ) {
        entry.publishedAt = now;
      }
    }
  }

  /** @inheritdoc */
  async deletePublished(olderThan?: Date): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.publishedAt !== null) {
        if (!olderThan || new Date(entry.createdAt) < olderThan) {
          this.entries.delete(id);
        }
      }
    }
  }

  /** Convenience method for test inspection. Returns all entries. */
  findAll(): OutboxEntry[] {
    return [...this.entries.values()];
  }
}
