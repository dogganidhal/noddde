import { Command } from "commander";
import { addCommandToAggregate } from "../generators/add-command.js";
import { addQueryToProjection } from "../generators/add-query.js";
import { addEventHandlerToProjection } from "../generators/add-event-handler.js";
import {
  resolveAggregateDir,
  resolveProjectionDir,
} from "../utils/discovery.js";
import { promptEventName } from "../utils/event-naming.js";
import { validateName } from "../utils/naming.js";

/** Registers the `add` command and its subcommands. */
export function registerAddCommand(program: Command): void {
  const addCmd = program
    .command("add")
    .alias("a")
    .description(
      "Add a command, query, or event handler to an existing module",
    );

  addCmd
    .command("command <name>")
    .alias("c")
    .description("Add a command (decider + evolver) to an existing aggregate")
    .option(
      "--aggregate <name>",
      "Target aggregate name (interactive if omitted)",
    )
    .option("--event <name>", "Override the derived event name")
    .action(
      async (name: string, opts: { aggregate?: string; event?: string }) => {
        validateName(name);
        const { dir } = await resolveAggregateDir(opts.aggregate);
        const eventName = opts.event ?? (await promptEventName(name));
        await addCommandToAggregate(name, dir, { eventName });
      },
    );

  addCmd
    .command("query <name>")
    .alias("q")
    .description("Add a query (handler) to an existing projection")
    .option(
      "--projection <name>",
      "Target projection name (interactive if omitted)",
    )
    .action(async (name: string, opts: { projection?: string }) => {
      validateName(name);
      const { dir } = await resolveProjectionDir(opts.projection);
      await addQueryToProjection(name, dir);
    });

  addCmd
    .command("event-handler <event-name>")
    .alias("eh")
    .description(
      "Add an event handler (on-entry / view reducer) to an existing projection",
    )
    .option(
      "--projection <name>",
      "Target projection name (interactive if omitted)",
    )
    .action(async (eventName: string, opts: { projection?: string }) => {
      validateName(eventName);
      const { dir } = await resolveProjectionDir(opts.projection);
      await addEventHandlerToProjection(eventName, dir);
    });
}
