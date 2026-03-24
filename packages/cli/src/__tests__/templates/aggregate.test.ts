import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { aggregateIndexTemplate } from "../../templates/aggregate/index.js";
import { eventsIndexTemplate } from "../../templates/aggregate/events-index.js";
import { eventTemplate } from "../../templates/aggregate/event.js";
import { commandsIndexTemplate } from "../../templates/aggregate/commands-index.js";
import { commandTemplate } from "../../templates/aggregate/command.js";
import { stateTemplate } from "../../templates/aggregate/state.js";
import { aggregateTemplate } from "../../templates/aggregate/aggregate.js";
import { infrastructureTemplate } from "../../templates/aggregate/infrastructure.js";

const ctx = buildContext("BankAccount");

describe("aggregate templates", () => {
  it("generates barrel index.ts", () => {
    const result = aggregateIndexTemplate(ctx);
    expect(result).toContain('export { BankAccount } from "./aggregate.js"');
    expect(result).toContain(
      'export type { BankAccountState } from "./state.js"',
    );
    expect(result).toContain(
      'export type { BankAccountEvent } from "./events/index.js"',
    );
    expect(result).toContain(
      'export type { BankAccountCommand } from "./commands/index.js"',
    );
    expect(result).toContain(
      'export type { BankAccountInfrastructure } from "./infrastructure.js"',
    );
  });

  it("generates events/index.ts with DefineEvents", () => {
    const result = eventsIndexTemplate(ctx);
    expect(result).toContain('import { DefineEvents } from "@noddde/core"');
    expect(result).toContain("BankAccountCreatedPayload");
    expect(result).toContain("type BankAccountEvent = DefineEvents<{");
    expect(result).toContain('from "./bank-account-created.js"');
  });

  it("generates individual event payload file", () => {
    const result = eventTemplate(ctx);
    expect(result).toContain("export interface BankAccountCreatedPayload");
    expect(result).toContain("id: string");
  });

  it("generates commands/index.ts with DefineCommands", () => {
    const result = commandsIndexTemplate(ctx);
    expect(result).toContain('import { DefineCommands } from "@noddde/core"');
    expect(result).toContain("CreateBankAccountPayload");
    expect(result).toContain("type BankAccountCommand = DefineCommands<{");
    expect(result).toContain('from "./create-bank-account.js"');
  });

  it("generates individual command payload file", () => {
    const result = commandTemplate(ctx);
    expect(result).toContain("export interface CreateBankAccountPayload");
  });

  it("generates state.ts with interface and initial state", () => {
    const result = stateTemplate(ctx);
    expect(result).toContain("export interface BankAccountState");
    expect(result).toContain(
      "export const initialBankAccountState: BankAccountState",
    );
  });

  it("generates aggregate.ts with defineAggregate", () => {
    const result = aggregateTemplate(ctx);
    expect(result).toContain('import { defineAggregate } from "@noddde/core"');
    expect(result).toContain("type BankAccountDef = {");
    expect(result).toContain(
      "export const BankAccount = defineAggregate<BankAccountDef>",
    );
    expect(result).toContain("initialState: initialBankAccountState");
    expect(result).toContain('name: "BankAccountCreated"');
    expect(result).toContain("CreateBankAccount:");
  });

  it("generates infrastructure.ts", () => {
    const result = infrastructureTemplate(ctx);
    expect(result).toContain(
      'import type { Infrastructure } from "@noddde/core"',
    );
    expect(result).toContain(
      "export interface BankAccountInfrastructure extends Infrastructure",
    );
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      aggregateIndexTemplate(ctx),
      eventsIndexTemplate(ctx),
      commandsIndexTemplate(ctx),
      aggregateTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
