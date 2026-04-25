import * as path from "node:path";
import { register } from "tsx/cjs/api";
import type { DomainDefinition } from "@noddde/engine";
import type { Aggregate, Projection, Saga } from "@noddde/core";

/**
 * The shape an entry file may export. The loader accepts either:
 *   - the structural form: `aggregates`, `projections`, optional `sagas`
 *   - a `definition` already produced by `defineDomain(...)`
 */
export interface LoadedDomain {
  definition: DomainDefinition;
  entryFile: string;
}

interface DomainModuleShape {
  aggregates?: Record<string, Aggregate>;
  projections?: Record<string, Projection>;
  sagas?: Record<string, Saga>;
  definition?: DomainDefinition;
}

/**
 * Loads a user's TypeScript domain entry file via tsx's CommonJS register hook
 * (no prebuild required). The entry must export either a `definition` from
 * `defineDomain(...)` OR named `aggregates`/`projections`/`sagas` records.
 */
export function loadDomain(entryFile: string): LoadedDomain {
  const absolute = path.resolve(entryFile);
  const unregister = register();

  let mod: DomainModuleShape;
  try {
    delete require.cache[absolute];
    mod = require(absolute) as DomainModuleShape;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Diagram failed to load '${entryFile}'. Ensure your domain module has no top-level infrastructure dependencies.\n  cause: ${reason}`,
    );
  } finally {
    unregister();
  }

  if (mod.definition) {
    return { definition: mod.definition, entryFile: absolute };
  }

  if (mod.aggregates || mod.projections) {
    const definition: DomainDefinition = {
      writeModel: { aggregates: (mod.aggregates ?? {}) as never },
      readModel: { projections: (mod.projections ?? {}) as never },
      ...(mod.sagas ? { processModel: { sagas: mod.sagas as never } } : {}),
    };
    return { definition, entryFile: absolute };
  }

  throw new Error(
    `Entry file '${entryFile}' does not export a 'definition', or 'aggregates'/'projections' records. ` +
      `Expected either: \`export const definition = defineDomain({...})\` ` +
      `or \`export const aggregates = {...}; export const projections = {...};\`.`,
  );
}
