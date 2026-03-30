import path from "node:path";
import { buildContext } from "../utils/context.js";
import { writeFileIfNotExists } from "../utils/fs.js";
import { validateName } from "../utils/naming.js";
import type { PersistenceAdapter } from "../utils/persistence.js";

// Project config templates
import { packageJsonTemplate } from "../templates/project/package-json.js";
import { tsconfigTemplate } from "../templates/project/tsconfig.js";
import { vitestConfigTemplate } from "../templates/project/vitest-config.js";
import { gitignoreTemplate } from "../templates/project/gitignore.js";
import { sampleTestTemplate } from "../templates/project/sample-test.js";

// Domain templates (reused — same structure as domain generator, under src/)
import {
  eventModelIndexTemplate,
  eventPayloadTemplate,
} from "../templates/domain/event-model.js";
import { writeModelIndexTemplate } from "../templates/domain/write-model.js";
import {
  domainAggregateIndexTemplate,
  domainAggregateTemplate,
} from "../templates/domain/aggregate.js";
import { aggregateStateTemplate } from "../templates/domain/aggregate-state.js";
import {
  commandsIndexTemplate,
  commandPayloadTemplate,
} from "../templates/domain/aggregate-commands.js";
import {
  commandHandlersIndexTemplate,
  commandHandlerTemplate,
} from "../templates/domain/aggregate-command-handlers.js";
import {
  applyHandlersIndexTemplate,
  applyHandlerTemplate,
} from "../templates/domain/aggregate-apply-handlers.js";
import {
  domainProjectionIndexTemplate,
  domainProjectionTemplate,
} from "../templates/domain/projection.js";
import {
  queriesIndexTemplate,
  queryPayloadTemplate,
} from "../templates/domain/projection-queries.js";
import {
  queryHandlersIndexTemplate,
  queryHandlerTemplate,
} from "../templates/domain/projection-query-handlers.js";
import {
  viewReducersIndexTemplate,
  viewReducerTemplate,
} from "../templates/domain/projection-view-reducers.js";
import {
  domainDefinitionTemplate,
  domainInfrastructureTemplate,
  domainMainTemplate,
} from "../templates/domain/domain-wiring.js";

/** Generates a complete project scaffold with config files and domain structure. */
export async function generateProject(
  name: string,
  basePath: string,
  adapter: PersistenceAdapter,
): Promise<void> {
  validateName(name);
  const ctx = buildContext(name);
  const dir = path.resolve(basePath, ctx.kebabName);

  const agg = `src/domain/write-model/aggregates/${ctx.kebabName}`;
  const proj = `src/domain/read-model/projections/${ctx.kebabName}`;

  const files: Array<{ relativePath: string; content: string }> = [
    // ── Project config ──────────────────────────────────────────
    {
      relativePath: "package.json",
      content: packageJsonTemplate(ctx, adapter),
    },
    { relativePath: "tsconfig.json", content: tsconfigTemplate() },
    { relativePath: "vitest.config.mts", content: vitestConfigTemplate() },
    { relativePath: ".gitignore", content: gitignoreTemplate() },

    // ── Sample test ─────────────────────────────────────────────
    {
      relativePath: `src/__tests__/${ctx.kebabName}.test.ts`,
      content: sampleTestTemplate(ctx),
    },

    // ── Event model ─────────────────────────────────────────────
    {
      relativePath: "src/domain/event-model/index.ts",
      content: eventModelIndexTemplate(ctx),
    },
    {
      relativePath: `src/domain/event-model/${ctx.kebabName}-created.ts`,
      content: eventPayloadTemplate(ctx),
    },

    // ── Write model ─────────────────────────────────────────────
    {
      relativePath: "src/domain/write-model/index.ts",
      content: writeModelIndexTemplate(ctx),
    },
    {
      relativePath: `${agg}/index.ts`,
      content: domainAggregateIndexTemplate(ctx),
    },
    {
      relativePath: `${agg}/state.ts`,
      content: aggregateStateTemplate(ctx),
    },
    {
      relativePath: `${agg}/${ctx.kebabName}.ts`,
      content: domainAggregateTemplate(ctx),
    },
    {
      relativePath: `${agg}/commands/index.ts`,
      content: commandsIndexTemplate(ctx),
    },
    {
      relativePath: `${agg}/commands/create-${ctx.kebabName}.ts`,
      content: commandPayloadTemplate(ctx),
    },
    {
      relativePath: `${agg}/command-handlers/index.ts`,
      content: commandHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `${agg}/command-handlers/handle-create-${ctx.kebabName}.ts`,
      content: commandHandlerTemplate(ctx),
    },
    {
      relativePath: `${agg}/apply-handlers/index.ts`,
      content: applyHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `${agg}/apply-handlers/apply-${ctx.kebabName}-created.ts`,
      content: applyHandlerTemplate(ctx),
    },

    // ── Read model ──────────────────────────────────────────────
    {
      relativePath: `${proj}/index.ts`,
      content: domainProjectionIndexTemplate(ctx),
    },
    {
      relativePath: `${proj}/${ctx.kebabName}.ts`,
      content: domainProjectionTemplate(ctx),
    },
    {
      relativePath: `${proj}/queries/index.ts`,
      content: queriesIndexTemplate(ctx),
    },
    {
      relativePath: `${proj}/queries/get-${ctx.kebabName}.ts`,
      content: queryPayloadTemplate(ctx),
    },
    {
      relativePath: `${proj}/query-handlers/index.ts`,
      content: queryHandlersIndexTemplate(ctx),
    },
    {
      relativePath: `${proj}/query-handlers/handle-get-${ctx.kebabName}.ts`,
      content: queryHandlerTemplate(ctx),
    },
    {
      relativePath: `${proj}/on-entries/index.ts`,
      content: viewReducersIndexTemplate(ctx),
    },
    {
      relativePath: `${proj}/on-entries/on-${ctx.kebabName}-created.ts`,
      content: viewReducerTemplate(ctx),
    },

    // ── Process model (empty — ready for sagas) ──────────────────
    {
      relativePath: "src/domain/process-model/.gitkeep",
      content: "",
    },

    // ── Domain definition ───────────────────────────────────────
    {
      relativePath: "src/domain/domain.ts",
      content: domainDefinitionTemplate(ctx),
    },

    // ── Infrastructure ──────────────────────────────────────────
    {
      relativePath: "src/infrastructure/index.ts",
      content: domainInfrastructureTemplate(ctx),
    },

    // ── Main ────────────────────────────────────────────────────
    {
      relativePath: "src/main.ts",
      content: domainMainTemplate(ctx),
    },
  ];

  for (const file of files) {
    const filePath = path.join(dir, file.relativePath);
    const created = await writeFileIfNotExists(filePath, file.content);
    if (created) {
      console.log(`  Created ${path.relative(process.cwd(), filePath)}`);
    } else {
      console.log(
        `  Skipped ${path.relative(process.cwd(), filePath)} (already exists)`,
      );
    }
  }
}
