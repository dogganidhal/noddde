import type {
  AsyncEventHandler,
  EventBus,
  EventReader,
  Logger,
  Projection,
  ViewStore,
  ViewStoreFactory,
} from "@noddde/core";
import { DeleteView } from "@noddde/core";

/**
 * Options accepted by {@link Domain.rebuildProjection}.
 *
 * All fields are optional. Omitting all of them is the common case for
 * one-shot ops rebuilds.
 */
export interface ProjectionRebuildOptions {
  /**
   * Optional logger override. When omitted, the rebuild uses the domain's
   * configured logger via `domain.infrastructure.logger.child("projection-rebuild")`.
   */
  logger?: Logger;

  /**
   * Number of events to apply before invoking `onProgress`.
   * Must be a positive integer. Defaults to 1000.
   *
   * Counted on `eventsApplied` (events the projection handles), NOT on
   * `eventsRead` — skipped events do not trigger progress callbacks.
   */
  progressInterval?: number;

  /**
   * Optional progress callback. Invoked synchronously inside the replay
   * loop (the loop awaits its return). Use to report ETA, write
   * heartbeats to a log, or update an admin UI.
   */
  onProgress?: (progress: { eventsApplied: number }) => void | Promise<void>;
}

/**
 * Result returned by a successful {@link Domain.rebuildProjection} call.
 */
export interface ProjectionRebuildResult {
  /** The projection name passed to `rebuildProjection`. */
  projectionName: string;

  /**
   * Total events the EventReader yielded during this rebuild. Includes
   * events that the projection's `on` map does not handle.
   */
  eventsRead: number;

  /**
   * Number of events that matched a handler in the projection's `on`
   * map and were applied (saved, updated, or deleted) to the view store.
   * Always `<= eventsRead`.
   */
  eventsApplied: number;

  /**
   * Number of times a reducer returned the `DeleteView` sentinel during
   * the replay (calls to `viewStore.delete(viewId)`). Always
   * `<= eventsApplied`.
   */
  viewsDeleted: number;

  /**
   * Wall-clock duration of the rebuild in milliseconds, from the moment
   * the method validates inputs to the moment subscriptions are
   * re-attached. Suitable for telemetry, not for SLA enforcement.
   */
  durationMs: number;
}

/**
 * Thrown when the projection name is not registered in the domain.
 */
export class ProjectionNotFoundError extends Error {
  override readonly name = "ProjectionNotFoundError" as const;
  constructor(public readonly projectionName: string) {
    super(`Projection "${projectionName}" is not registered in this domain.`);
  }
}

/**
 * Thrown when `rebuildProjection` is called on a projection whose
 * `consistency` is `"strong"`. v1 does not support rebuilding
 * strong-consistency projections (they would race with in-flight UoWs).
 */
export class StrongConsistencyRebuildError extends Error {
  override readonly name = "StrongConsistencyRebuildError" as const;
  constructor(public readonly projectionName: string) {
    super(
      `Projection "${projectionName}" uses strong consistency and cannot be rebuilt. ` +
        `v1 supports eventual-consistency projections only.`,
    );
  }
}

/**
 * Thrown when no `EventReader` is resolvable from the wired
 * `PersistenceAdapter.eventReader` or from the resolved event-sourced
 * persistence (which the in-memory implementation structurally provides).
 */
export class EventReaderUnavailableError extends Error {
  override readonly name = "EventReaderUnavailableError" as const;
  constructor() {
    super(
      "No EventReader is available. Provide a persistenceAdapter.eventReader or use " +
        "InMemoryEventSourcedAggregatePersistence (which implements EventReader structurally).",
    );
  }
}

/**
 * Thrown when the projection's view store does not implement the
 * optional `truncate()` method. Adapter authors implementing
 * production view stores should add `truncate()` so rebuild becomes
 * available.
 */
export class ViewStoreNotTruncatableError extends Error {
  override readonly name = "ViewStoreNotTruncatableError" as const;
  constructor(public readonly projectionName: string) {
    super(
      `Projection "${projectionName}": the view store does not implement truncate(). ` +
        `Rebuild requires a view store that can clear all entries atomically.`,
    );
  }
}

/**
 * Thrown when the projection has no `ViewStoreFactory` wired. Rebuild is
 * meaningless without a target store; the caller likely forgot to
 * configure `DomainWiring.projections[name].viewStore`.
 */
export class MissingViewStoreFactoryError extends Error {
  override readonly name = "MissingViewStoreFactoryError" as const;
  constructor(public readonly projectionName: string) {
    super(
      `Projection "${projectionName}" has no viewStore factory configured. ` +
        `Set DomainWiring.projections["${projectionName}"].viewStore to enable rebuild.`,
    );
  }
}

/**
 * Internal context passed from `Domain.rebuildProjection` to the
 * `rebuildProjectionImpl` helper. Contains all pre-validated,
 * pre-resolved dependencies.
 * @internal
 */
export interface RebuildContext {
  projectionName: string;
  projection: Projection<any>;
  viewStore: ViewStore;
  viewStoreFactory: ViewStoreFactory;
  eventReader: EventReader;
  eventBus: EventBus;
  /** projectionName → eventName → handler reference */
  subscriptionRegistry: Map<string, Map<string, AsyncEventHandler>>;
  logger: Logger;
}

/**
 * Executes the full rebuild pipeline: detach subscriptions, truncate the
 * view store, replay events, re-attach subscriptions.
 *
 * Subscriptions are always re-attached in the `finally` block — even when
 * truncate or replay fails — so live event delivery resumes after the
 * method returns (or throws).
 *
 * @internal
 */
export async function rebuildProjectionImpl(
  ctx: RebuildContext,
  options: ProjectionRebuildOptions,
): Promise<ProjectionRebuildResult> {
  const {
    projectionName,
    projection,
    viewStore,
    eventReader,
    eventBus,
    subscriptionRegistry,
    logger,
  } = ctx;

  const progressInterval = options.progressInterval ?? 1000;
  const onProgress = options.onProgress;

  const startMs = Date.now();

  logger.info(`rebuilding ${projectionName}`);

  const projSubs = subscriptionRegistry.get(projectionName);

  const busWithOff = eventBus as EventBus & {
    off?: (name: string, handler: AsyncEventHandler) => void;
  };

  if (projSubs && busWithOff.off) {
    for (const [eventName, handler] of projSubs.entries()) {
      busWithOff.off(eventName, handler);
    }
  } else if (projSubs && projSubs.size > 0 && !busWithOff.off) {
    throw new Error(
      "rebuildProjection: the wired EventBus does not support listener removal (no 'off' method). " +
        "Cannot safely detach projection subscriptions during rebuild.",
    );
  }

  try {
    await (viewStore as ViewStore & { truncate(): Promise<void> }).truncate();

    let eventsRead = 0;
    let eventsApplied = 0;
    let viewsDeleted = 0;

    for await (const event of eventReader.read()) {
      eventsRead++;

      const handler = (projection.on as Record<string, any>)[event.name];
      if (!handler) continue;

      const viewId = handler.id
        ? handler.id(event)
        : event.metadata?.aggregateId;

      if (viewId == null) {
        throw new Error(
          `rebuildProjection: cannot derive viewId for event '${event.name}'; ` +
            `projection.on['${event.name}'].id is required`,
        );
      }

      const current = (await viewStore.load(viewId)) ?? projection.initialView;
      const next = await handler.reduce(event, current);

      if (next === DeleteView) {
        await viewStore.delete(viewId);
        viewsDeleted++;
      } else {
        await viewStore.save(viewId, next);
      }
      eventsApplied++;

      if (eventsApplied % progressInterval === 0) {
        logger.debug(`${projectionName}: applied ${eventsApplied} events`);
        await onProgress?.({ eventsApplied });
      }
    }

    const durationMs = Date.now() - startMs;

    logger.info(
      `rebuilt ${projectionName}: read=${eventsRead} applied=${eventsApplied} deleted=${viewsDeleted} durationMs=${durationMs}`,
    );

    return {
      projectionName,
      eventsRead,
      eventsApplied,
      viewsDeleted,
      durationMs,
    };
  } catch (err) {
    logger.error(
      `rebuild ${projectionName} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  } finally {
    if (projSubs && busWithOff.off) {
      for (const [eventName, handler] of projSubs.entries()) {
        eventBus.on(eventName, handler);
      }
    }
  }
}
