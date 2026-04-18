import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { select } from "@inquirer/prompts";
import { toPascalCase, toKebabCase } from "./naming.js";

/** Discovered module entry. */
export interface DiscoveredModule {
  /** PascalCase display name derived from directory name. */
  name: string;
  /** Absolute path to the module directory. */
  dir: string;
}

const AGGREGATE_BASE = "src/domain/write-model/aggregates";
const PROJECTION_BASE = "src/domain/read-model/projections";

/**
 * Scans for existing aggregate directories under the project's write-model path.
 * A directory is considered an aggregate if it contains a `.ts` definition file
 * matching its kebab-case name.
 */
export async function discoverAggregates(
  projectRoot?: string,
): Promise<DiscoveredModule[]> {
  const root = projectRoot ?? process.cwd();
  const base = path.resolve(root, AGGREGATE_BASE);

  try {
    await access(base);
  } catch {
    return [];
  }

  const entries = await readdir(base, { withFileTypes: true });
  const modules: DiscoveredModule[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const defFile = path.join(base, entry.name, `${entry.name}.ts`);
    try {
      await access(defFile);
      modules.push({
        name: toPascalCase(entry.name),
        dir: path.join(base, entry.name),
      });
    } catch {
      // Not a valid aggregate directory — skip
    }
  }

  return modules;
}

/**
 * Scans for existing projection directories under the project's read-model path.
 * A directory is considered a projection if it contains a `.ts` definition file
 * matching its kebab-case name.
 */
export async function discoverProjections(
  projectRoot?: string,
): Promise<DiscoveredModule[]> {
  const root = projectRoot ?? process.cwd();
  const base = path.resolve(root, PROJECTION_BASE);

  try {
    await access(base);
  } catch {
    return [];
  }

  const entries = await readdir(base, { withFileTypes: true });
  const modules: DiscoveredModule[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const defFile = path.join(base, entry.name, `${entry.name}.ts`);
    try {
      await access(defFile);
      modules.push({
        name: toPascalCase(entry.name),
        dir: path.join(base, entry.name),
      });
    } catch {
      // Not a valid projection directory — skip
    }
  }

  return modules;
}

/**
 * Resolves an aggregate directory from a name hint or interactive selection.
 * If `nameHint` is provided, resolves the path directly.
 * Otherwise, discovers aggregates and prompts the user to select one.
 */
export async function resolveAggregateDir(
  nameHint?: string,
): Promise<DiscoveredModule> {
  if (nameHint) {
    const base = path.resolve(process.cwd(), AGGREGATE_BASE);
    const kebab = toKebabCase(nameHint);
    const dir = path.join(base, kebab);
    try {
      await access(dir);
    } catch {
      throw new Error(
        `Aggregate "${nameHint}" not found at ${dir}.\n` +
          `Create it first with: noddde new aggregate ${nameHint}\n`,
      );
    }
    return { name: toPascalCase(nameHint), dir };
  }

  const aggregates = await discoverAggregates();
  if (aggregates.length === 0) {
    throw new Error(
      `No aggregates found in ${AGGREGATE_BASE}.\n` +
        `Create one first with: noddde new aggregate <name>\n`,
    );
  }

  const chosen = await select<string>({
    message: "Which aggregate?",
    choices: aggregates.map((a) => ({ name: a.name, value: a.dir })),
  });

  return aggregates.find((a) => a.dir === chosen)!;
}

/**
 * Resolves a projection directory from a name hint or interactive selection.
 * If `nameHint` is provided, resolves the path directly.
 * Otherwise, discovers projections and prompts the user to select one.
 */
export async function resolveProjectionDir(
  nameHint?: string,
): Promise<DiscoveredModule> {
  if (nameHint) {
    const base = path.resolve(process.cwd(), PROJECTION_BASE);
    const kebab = toKebabCase(nameHint);
    const dir = path.join(base, kebab);
    try {
      await access(dir);
    } catch {
      throw new Error(
        `Projection "${nameHint}" not found at ${dir}.\n` +
          `Create it first with: noddde new projection ${nameHint}\n`,
      );
    }
    return { name: toPascalCase(nameHint), dir };
  }

  const projections = await discoverProjections();
  if (projections.length === 0) {
    throw new Error(
      `No projections found in ${PROJECTION_BASE}.\n` +
        `Create one first with: noddde new projection <name>\n`,
    );
  }

  const chosen = await select<string>({
    message: "Which projection?",
    choices: projections.map((p) => ({ name: p.name, value: p.dir })),
  });

  return projections.find((p) => p.dir === chosen)!;
}
