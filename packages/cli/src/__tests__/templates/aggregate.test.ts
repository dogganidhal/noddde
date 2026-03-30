import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import { aggregateIndexTemplate } from "../../templates/aggregate/index.js";
import { aggregateTemplate } from "../../templates/aggregate/aggregate.js";
import { aggregateStateTemplate } from "../../templates/domain/aggregate-state.js";
import {
  commandsIndexTemplate,
  commandPayloadTemplate,
} from "../../templates/domain/aggregate-commands.js";
import {
  decidersIndexTemplate,
  deciderTemplate,
} from "../../templates/domain/aggregate-deciders.js";
import {
  evolversIndexTemplate,
  evolverTemplate,
} from "../../templates/domain/aggregate-evolvers.js";

const ctx = buildContext("BankAccount");

describe("aggregate templates", () => {
  it("generates barrel index.ts", () => {
    const result = aggregateIndexTemplate(ctx);
    expect(result).toContain('export { BankAccount } from "./bank-account.js"');
    expect(result).toContain('from "./state.js"');
    expect(result).toContain("BankAccountState");
    expect(result).toContain("BankAccountEvent");
    expect(result).toContain("BankAccountCommand");
  });

  it("generates state.ts with interface and initial state", () => {
    const result = aggregateStateTemplate(ctx);
    expect(result).toContain("interface BankAccountState");
    expect(result).toContain("initialBankAccountState: BankAccountState");
  });

  it("generates aggregate with DefineEvents/DefineCommands and imported handlers", () => {
    const result = aggregateTemplate(ctx);
    expect(result).toContain("defineAggregate");
    expect(result).toContain("DefineEvents");
    expect(result).toContain("DefineCommands");
    expect(result).toContain("export type BankAccountDef");
    expect(result).toContain("BankAccountState");
    expect(result).toContain("initialBankAccountState");
    expect(result).toContain("decideCreateBankAccount");
    expect(result).toContain("evolveBankAccountCreated");
    expect(result).toContain('from "./commands/create-bank-account.js"');
    expect(result).toContain('from "./deciders/index.js"');
    expect(result).toContain('from "./evolvers/index.js"');
  });

  it("generates command payload interface", () => {
    const result = commandPayloadTemplate(ctx);
    expect(result).toContain("interface CreateBankAccountPayload");
  });

  it("generates commands barrel", () => {
    const result = commandsIndexTemplate(ctx);
    expect(result).toContain("CreateBankAccountPayload");
  });

  it("generates standalone decide handler using InferDecideHandler", () => {
    const result = deciderTemplate(ctx);
    expect(result).toContain("InferDecideHandler");
    expect(result).toContain("BankAccountDef");
    expect(result).toContain("decideCreateBankAccount");
    expect(result).toContain('"BankAccountCreated" as const');
  });

  it("generates deciders barrel", () => {
    const result = decidersIndexTemplate(ctx);
    expect(result).toContain("decideCreateBankAccount");
  });

  it("generates standalone evolve handler using InferEvolveHandler", () => {
    const result = evolverTemplate(ctx);
    expect(result).toContain("InferEvolveHandler");
    expect(result).toContain("BankAccountDef");
    expect(result).toContain("evolveBankAccountCreated");
  });

  it("generates evolvers barrel", () => {
    const result = evolversIndexTemplate(ctx);
    expect(result).toContain("evolveBankAccountCreated");
    expect(result).toContain("evolve-bank-account-created.js");
  });

  it("uses .js extensions for all local imports", () => {
    const templates = [
      aggregateIndexTemplate(ctx),
      aggregateTemplate(ctx),
      commandsIndexTemplate(ctx),
      decidersIndexTemplate(ctx),
      evolversIndexTemplate(ctx),
      evolverTemplate(ctx),
    ];
    for (const tmpl of templates) {
      const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
      for (const imp of localImports) {
        expect(imp).toMatch(/\.js"$/);
      }
    }
  });
});
