import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { aggregateIndexTemplate } from "../../templates/aggregate/index.js";
import { aggregateTemplate } from "../../templates/aggregate/aggregate.js";
import {
  commandsIndexTemplate,
  commandPayloadTemplate,
} from "../../templates/domain/aggregate-commands.js";
import {
  commandHandlersIndexTemplate,
  commandHandlerTemplate,
} from "../../templates/domain/aggregate-command-handlers.js";

const ctx = buildContext("BankAccount");

describe("aggregate templates", () => {
  it("generates barrel index.ts", () => {
    const result = aggregateIndexTemplate(ctx);
    expect(result).toContain('export { BankAccount } from "./bank-account.js"');
    expect(result).toContain("BankAccountState");
    expect(result).toContain("BankAccountEvent");
    expect(result).toContain("BankAccountCommand");
  });

  it("generates aggregate with DefineEvents/DefineCommands and imported handler", () => {
    const result = aggregateTemplate(ctx);
    expect(result).toContain("defineAggregate");
    expect(result).toContain("DefineEvents");
    expect(result).toContain("DefineCommands");
    expect(result).toContain("BankAccountDef");
    expect(result).toContain("BankAccountState");
    expect(result).toContain("initialBankAccountState");
    expect(result).toContain("handleCreateBankAccount");
    expect(result).toContain('from "./commands/create-bank-account.js"');
    expect(result).toContain('from "./command-handlers/index.js"');
  });

  it("generates command payload interface", () => {
    const result = commandPayloadTemplate(ctx);
    expect(result).toContain("interface CreateBankAccountPayload");
  });

  it("generates commands barrel", () => {
    const result = commandsIndexTemplate(ctx);
    expect(result).toContain("CreateBankAccountPayload");
  });

  it("generates standalone command handler", () => {
    const result = commandHandlerTemplate(ctx);
    expect(result).toContain("export function handleCreateBankAccount");
    expect(result).toContain('"BankAccountCreated" as const');
  });

  it("generates command handlers barrel", () => {
    const result = commandHandlersIndexTemplate(ctx);
    expect(result).toContain("handleCreateBankAccount");
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      aggregateIndexTemplate(ctx),
      aggregateTemplate(ctx),
      commandsIndexTemplate(ctx),
      commandHandlersIndexTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
