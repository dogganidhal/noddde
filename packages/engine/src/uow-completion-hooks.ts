import type { UnitOfWork } from "@noddde/core";

type CompletionHooks = {
  onCommitted: Array<() => Promise<void>>;
  onSettled: Array<() => Promise<void>>;
};

const registry = new WeakMap<UnitOfWork, CompletionHooks>();

function getOrCreate(uow: UnitOfWork): CompletionHooks {
  let hooks = registry.get(uow);
  if (!hooks) {
    hooks = { onCommitted: [], onSettled: [] };
    registry.set(uow, hooks);
  }
  return hooks;
}

/** Registers `hook` to run only if `uow` commits successfully. */
export function onUowCommitted(
  uow: UnitOfWork,
  hook: () => Promise<void>,
): void {
  getOrCreate(uow).onCommitted.push(hook);
}

/** Registers `hook` to run unconditionally, whether `uow` commits or rolls back. */
export function onUowSettled(uow: UnitOfWork, hook: () => Promise<void>): void {
  getOrCreate(uow).onSettled.push(hook);
}

/**
 * Runs the completion hooks registered for `uow`, then clears its
 * registration. Called exactly once by whichever code owns `uow`'s
 * commit/rollback (`Domain.withUnitOfWork`, `SagaExecutor`), after the
 * UoW has settled. `onCommitted` hooks run first, only if `committed`
 * is `true`, then `onSettled` hooks always run. A UoW nobody registered
 * hooks on is a no-op lookup.
 */
export async function runUowCompletionHooks(
  uow: UnitOfWork,
  committed: boolean,
): Promise<void> {
  const hooks = registry.get(uow);
  if (!hooks) return;
  registry.delete(uow);

  if (committed) {
    for (const hook of hooks.onCommitted) {
      await hook();
    }
  }
  for (const hook of hooks.onSettled) {
    await hook();
  }
}
