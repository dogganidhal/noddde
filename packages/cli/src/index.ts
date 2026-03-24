#!/usr/bin/env node
import { Command } from "commander";
import { registerNewCommand } from "./commands/new.js";

const program = new Command();

program
  .name("noddde")
  .description("CLI tool for scaffolding noddde DDD modules")
  .version("0.0.0");

registerNewCommand(program);

program.parse();
