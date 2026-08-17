#!/usr/bin/env node
import { Command } from "commander";
import { registerNewCommand } from "./commands/new.js";
import { registerAddCommand } from "./commands/add.js";
import { registerDiagramCommand } from "./commands/diagram.js";
import { getCliVersion } from "./utils/cli-version.js";

const program = new Command();

program
  .name("noddde")
  .description("CLI tool for scaffolding noddde DDD modules")
  .version(getCliVersion());

registerNewCommand(program);
registerAddCommand(program);
registerDiagramCommand(program);

program.parse();
