import { Command } from "commander";
import { generateAggregate } from "../generators/aggregate.js";
import { generateProjection } from "../generators/projection.js";
import { generateSaga } from "../generators/saga.js";
import { generateDomain } from "../generators/domain.js";
import { generateProject } from "../generators/project.js";
import { promptPersistenceAdapter } from "../utils/persistence.js";
import { promptEventBusAdapter } from "../utils/event-bus.js";
import { resolveProjectPath } from "../utils/project.js";

/** Registers the `new` command and its subcommands. */
export function registerNewCommand(program: Command): void {
  const newCmd = program
    .command("new")
    .alias("n")
    .description("Generate a new noddde module");

  newCmd
    .command("aggregate <name>")
    .alias("a")
    .description("Generate an aggregate with commands and command handlers")
    .action(async (name: string) => {
      const basePath = await resolveProjectPath("aggregate");
      await generateAggregate(name, basePath);
    });

  newCmd
    .command("projection <name>")
    .alias("p")
    .description(
      "Generate a projection with queries, query handlers, and view reducers",
    )
    .action(async (name: string) => {
      const basePath = await resolveProjectPath("projection");
      await generateProjection(name, basePath);
    });

  newCmd
    .command("saga <name>")
    .alias("s")
    .description("Generate a saga with state and event handlers")
    .action(async (name: string) => {
      const basePath = await resolveProjectPath("saga");
      await generateSaga(name, basePath);
    });

  newCmd
    .command("domain <name>")
    .alias("d")
    .description(
      "Generate a complete domain with aggregate, projection, infrastructure, and wiring",
    )
    .action(async (name: string) => {
      await generateDomain(name, ".");
    });

  newCmd
    .command("project <name>")
    .alias("pr")
    .description(
      "Generate a full project with package.json, tsconfig, tests, and domain scaffold",
    )
    .action(async (name: string) => {
      const adapter = await promptPersistenceAdapter();
      const eventBus = await promptEventBusAdapter();
      await generateProject(name, ".", adapter, eventBus);
    });
}
