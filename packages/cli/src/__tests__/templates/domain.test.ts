import { describe, it, expect } from "vitest";
import { buildContext } from "../../utils/context.js";
import {
  eventModelIndexTemplate,
  eventPayloadTemplate,
} from "../../templates/domain/event-model.js";
import { writeModelIndexTemplate } from "../../templates/domain/write-model.js";
import {
  domainAggregateIndexTemplate,
  domainAggregateTemplate,
} from "../../templates/domain/aggregate.js";
import {
  commandsIndexTemplate,
  commandPayloadTemplate,
} from "../../templates/domain/aggregate-commands.js";
import {
  decidersIndexTemplate,
  deciderTemplate,
} from "../../templates/domain/aggregate-deciders.js";
import {
  domainProjectionIndexTemplate,
  domainProjectionTemplate,
} from "../../templates/domain/projection.js";
import {
  queriesIndexTemplate,
  queryPayloadTemplate,
} from "../../templates/domain/projection-queries.js";
import {
  queryHandlersIndexTemplate,
  queryHandlerTemplate,
} from "../../templates/domain/projection-query-handlers.js";
import {
  evolversIndexTemplate,
  evolverTemplate,
} from "../../templates/domain/aggregate-evolvers.js";
import {
  viewReducersIndexTemplate,
  viewReducerTemplate,
} from "../../templates/domain/projection-view-reducers.js";
import {
  domainDefinitionTemplate,
  domainInfrastructureTemplate,
  domainMainTemplate,
} from "../../templates/domain/domain-wiring.js";

const ctx = buildContext("BankAccount");

describe("domain templates", () => {
  describe("event model", () => {
    it("generates event-model barrel", () => {
      const result = eventModelIndexTemplate(ctx);
      expect(result).toContain("BankAccountCreatedPayload");
      expect(result).toContain("bank-account-created.js");
    });

    it("generates event payload interface", () => {
      const result = eventPayloadTemplate(ctx);
      expect(result).toContain("interface BankAccountCreatedPayload");
      expect(result).toContain("id: string");
    });
  });

  describe("write model", () => {
    it("generates write-model barrel", () => {
      const result = writeModelIndexTemplate(ctx);
      expect(result).toContain("BankAccount");
      expect(result).toContain("BankAccountState");
      expect(result).toContain("BankAccountEvent");
      expect(result).toContain("BankAccountCommand");
    });

    it("generates aggregate barrel", () => {
      const result = domainAggregateIndexTemplate(ctx);
      expect(result).toContain(
        'export { BankAccount } from "./bank-account.js"',
      );
      expect(result).toContain("BankAccountState");
      expect(result).toContain("BankAccountEvent");
      expect(result).toContain("BankAccountCommand");
    });

    it("generates aggregate with DefineEvents/DefineCommands and extracted handlers", () => {
      const result = domainAggregateTemplate(ctx);
      expect(result).toContain("defineAggregate");
      expect(result).toContain("DefineEvents");
      expect(result).toContain("DefineCommands");
      expect(result).toContain("BankAccountCreatedPayload");
      expect(result).toContain("CreateBankAccountPayload");
      expect(result).toContain("export type BankAccountDef");
      expect(result).toContain("decideCreateBankAccount");
      expect(result).toContain("evolveBankAccountCreated");
      expect(result).toContain('from "./evolvers/index.js"');
    });

    it("generates command payload interface", () => {
      const result = commandPayloadTemplate(ctx);
      expect(result).toContain("interface CreateBankAccountPayload");
    });

    it("generates deciders barrel", () => {
      const result = decidersIndexTemplate(ctx);
      expect(result).toContain("decideCreateBankAccount");
    });

    it("generates standalone decide handler using InferDecideHandler", () => {
      const result = deciderTemplate(ctx);
      expect(result).toContain("InferDecideHandler");
      expect(result).toContain("BankAccountDef");
      expect(result).toContain("decideCreateBankAccount");
      expect(result).toContain('"BankAccountCreated" as const');
      expect(result).toContain("command.targetAggregateId");
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
    });
  });

  describe("read model", () => {
    it("generates projection barrel", () => {
      const result = domainProjectionIndexTemplate(ctx);
      expect(result).toContain("BankAccountProjection");
      expect(result).toContain("BankAccountView");
      expect(result).toContain("BankAccountQuery");
    });

    it("generates projection with on map, exported Def, and InferProjectionQueryHandler", () => {
      const result = domainProjectionTemplate(ctx);
      expect(result).toContain("defineProjection");
      expect(result).toContain("on:");
      expect(result).toContain("handleGetBankAccount");
      expect(result).toContain("export type BankAccountProjectionDef");
      expect(result).toContain("ViewStore");
      expect(result).not.toContain("reducers:");
    });

    it("generates queries barrel with View + DefineQueries", () => {
      const result = queriesIndexTemplate(ctx);
      expect(result).toContain("interface BankAccountView");
      expect(result).toContain("DefineQueries");
      expect(result).toContain("GetBankAccount:");
      expect(result).toContain("GetBankAccountPayload");
    });

    it("generates query payload interface", () => {
      const result = queryPayloadTemplate(ctx);
      expect(result).toContain("interface GetBankAccountPayload");
      expect(result).toContain("id: string");
    });

    it("generates standalone query handler using InferProjectionQueryHandler", () => {
      const result = queryHandlerTemplate(ctx);
      expect(result).toContain("InferProjectionQueryHandler");
      expect(result).toContain("BankAccountProjectionDef");
      expect(result).toContain("handleGetBankAccount");
    });

    it("generates on-entries barrel", () => {
      const result = viewReducersIndexTemplate(ctx);
      expect(result).toContain("onBankAccountCreated");
    });

    it("generates standalone on-entry with InferProjectionEventHandler comment", () => {
      const result = viewReducerTemplate(ctx);
      expect(result).toContain("export function onBankAccountCreated");
      expect(result).toContain("BankAccountView");
      expect(result).toContain("event.payload.id");
      expect(result).toContain("InferProjectionEventHandler");
    });
  });

  describe("domain wiring", () => {
    it("generates domain.ts with defineDomain", () => {
      const result = domainDefinitionTemplate(ctx);
      expect(result).toContain("defineDomain");
      expect(result).toContain("BankAccountInfrastructure");
      expect(result).toContain("bankAccountDomain");
      expect(result).toContain("BankAccount");
      expect(result).toContain("BankAccountProjection");
    });

    it("generates infrastructure interface", () => {
      const result = domainInfrastructureTemplate(ctx);
      expect(result).toContain("Infrastructure");
      expect(result).toContain("BankAccountInfrastructure");
    });

    it("generates main.ts with wireDomain", () => {
      const result = domainMainTemplate(ctx);
      expect(result).toContain("wireDomain");
      expect(result).toContain("InMemoryCommandBus");
      expect(result).toContain("EventEmitterEventBus");
      expect(result).toContain("InMemoryQueryBus");
      expect(result).toContain("bankAccountDomain");
    });
  });

  describe("import conventions", () => {
    it("uses .js extensions for all local imports", () => {
      const templates = [
        eventModelIndexTemplate(ctx),
        writeModelIndexTemplate(ctx),
        domainAggregateIndexTemplate(ctx),
        domainAggregateTemplate(ctx),
        commandsIndexTemplate(ctx),
        decidersIndexTemplate(ctx),
        evolversIndexTemplate(ctx),
        evolverTemplate(ctx),
        domainProjectionIndexTemplate(ctx),
        domainProjectionTemplate(ctx),
        queriesIndexTemplate(ctx),
        queryHandlersIndexTemplate(ctx),
        queryHandlerTemplate(ctx),
        viewReducersIndexTemplate(ctx),
        viewReducerTemplate(ctx),
        domainDefinitionTemplate(ctx),
        domainMainTemplate(ctx),
      ];
      for (const tmpl of templates) {
        const localImports = tmpl.match(/from\s+"\.\.?\/[^"]+"/g) ?? [];
        for (const imp of localImports) {
          expect(imp).toMatch(/\.js"$/);
        }
      }
    });
  });
});
