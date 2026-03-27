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
  commandHandlersIndexTemplate,
  commandHandlerTemplate,
} from "../../templates/domain/aggregate-command-handlers.js";
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

    it("generates aggregate with DefineEvents/DefineCommands inline", () => {
      const result = domainAggregateTemplate(ctx);
      expect(result).toContain("defineAggregate");
      expect(result).toContain("DefineEvents");
      expect(result).toContain("DefineCommands");
      expect(result).toContain("BankAccountCreatedPayload");
      expect(result).toContain("CreateBankAccountPayload");
      expect(result).toContain("handleCreateBankAccount");
    });

    it("generates command payload interface", () => {
      const result = commandPayloadTemplate(ctx);
      expect(result).toContain("interface CreateBankAccountPayload");
    });

    it("generates command handlers barrel", () => {
      const result = commandHandlersIndexTemplate(ctx);
      expect(result).toContain("handleCreateBankAccount");
    });

    it("generates standalone command handler", () => {
      const result = commandHandlerTemplate(ctx);
      expect(result).toContain("export function handleCreateBankAccount");
      expect(result).toContain('"BankAccountCreated" as const');
      expect(result).toContain("command.targetAggregateId");
    });
  });

  describe("read model", () => {
    it("generates projection barrel", () => {
      const result = domainProjectionIndexTemplate(ctx);
      expect(result).toContain("BankAccountProjection");
      expect(result).toContain("BankAccountView");
      expect(result).toContain("BankAccountQuery");
    });

    it("generates projection with on map and imported handlers", () => {
      const result = domainProjectionTemplate(ctx);
      expect(result).toContain("defineProjection");
      expect(result).toContain("on:");
      expect(result).toContain("handleGetBankAccount");
      expect(result).toContain("onBankAccountCreated");
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

    it("generates standalone query handler", () => {
      const result = queryHandlerTemplate(ctx);
      expect(result).toContain("export async function handleGetBankAccount");
      expect(result).toContain("ViewStore");
      expect(result).toContain("BankAccountView");
    });

    it("generates view reducers barrel", () => {
      const result = viewReducersIndexTemplate(ctx);
      expect(result).toContain("onBankAccountCreated");
    });

    it("generates standalone view reducer", () => {
      const result = viewReducerTemplate(ctx);
      expect(result).toContain("export function onBankAccountCreated");
      expect(result).toContain("BankAccountView");
      expect(result).toContain("event.payload.id");
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
        commandHandlersIndexTemplate(ctx),
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
