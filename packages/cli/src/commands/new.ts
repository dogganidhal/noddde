import { Command } from "commander";
import { generateAggregate } from "../generators/aggregate.js";
import { generateProjection } from "../generators/projection.js";
import { generateSaga } from "../generators/saga.js";
import { generateDomain } from "../generators/domain.js";

/** Registers the `new` command and its subcommands. */
export function registerNewCommand(program: Command): void {
  const newCmd = program
    .command("new")
    .alias("n")
    .description("Generate a new noddde module");

  newCmd
    .command("aggregate <name>")
    .alias("a")
    .description(
      "Generate an aggregate with events, commands, state, and infrastructure",
    )
    .option("-p, --path <dir>", "Target directory", ".")
    .action(async (name: string, opts: { path: string }) => {
      await generateAggregate(name, opts.path);
    });

  newCmd
    .command("projection <name>")
    .alias("p")
    .description(
      "Generate a projection with view, queries, and projection definition",
    )
    .option("-p, --path <dir>", "Target directory", ".")
    .action(async (name: string, opts: { path: string }) => {
      await generateProjection(name, opts.path);
    });

  newCmd
    .command("saga <name>")
    .alias("s")
    .description("Generate a saga with state, handlers, and saga definition")
    .option("-p, --path <dir>", "Target directory", ".")
    .action(async (name: string, opts: { path: string }) => {
      await generateSaga(name, opts.path);
    });

  newCmd
    .command("domain <name>")
    .alias("d")
    .description(
      "Generate a complete domain with aggregate, projection, infrastructure, and wiring",
    )
    .option("-p, --path <dir>", "Target directory", ".")
    .action(async (name: string, opts: { path: string }) => {
      await generateDomain(name, opts.path);
    });
}
