import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateProject } from "../generators/project.js";
import { generateDomain } from "../generators/domain.js";
import { generateAggregate } from "../generators/aggregate.js";
import { generateProjection } from "../generators/projection.js";
import { generateSaga } from "../generators/saga.js";
import { addCommandToAggregate } from "../generators/add-command.js";
import { addQueryToProjection } from "../generators/add-query.js";
import { addEventHandlerToProjection } from "../generators/add-event-handler.js";
import type { EventBusAdapter } from "../utils/event-bus.js";
import {
  linkWorkspaceNodeModules,
  typecheckProject,
} from "./support/compile-project.js";

/**
 * These tests are the "compile the scaffold" gate: they write real generator
 * output to a temp directory, resolve `@noddde/*` against the real,
 * already-built workspace packages, and run `tsc --noEmit`. String
 * containment assertions elsewhere in `__tests__/templates` and
 * `__tests__/generators` check individual snippets; only this file catches
 * drift between what a template emits and what the current framework API
 * actually accepts. See specs/cli/generators.spec.md.
 */

const tmpDirs: string[] = [];

async function makeProject(eventBus: EventBusAdapter = "event-emitter") {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "noddde-compile-"));
  tmpDirs.push(tmpDir);
  await generateProject("Shop", tmpDir, "in-memory", eventBus);
  const projectDir = path.join(tmpDir, "shop");
  await linkWorkspaceNodeModules(projectDir);
  return projectDir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("generateProject", () => {
  it.each<EventBusAdapter>(["event-emitter", "kafka", "nats", "rabbitmq"])(
    "produces a tsc-clean project with the %s event bus",
    async (eventBus) => {
      const projectDir = await makeProject(eventBus);
      const result = await typecheckProject(projectDir);
      expect(result.ok, result.output).toBe(true);
    },
  );
});

describe("generateDomain", () => {
  it("produces tsc-clean output dropped into an existing project", async () => {
    const projectDir = await makeProject();
    await generateDomain("Billing", path.join(projectDir, "src", "domains"));
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("generateAggregate", () => {
  it("produces tsc-clean standalone output", async () => {
    const projectDir = await makeProject();
    await generateAggregate(
      "Widget",
      path.join(projectDir, "src", "standalone"),
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("generateProjection", () => {
  it("produces tsc-clean standalone output", async () => {
    const projectDir = await makeProject();
    await generateProjection(
      "WidgetSummary",
      path.join(projectDir, "src", "standalone"),
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("generateSaga", () => {
  it("produces tsc-clean output with no TODOs filled in", async () => {
    const projectDir = await makeProject();
    await generateSaga(
      "Fulfillment",
      path.join(projectDir, "src", "standalone"),
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("addCommandToAggregate", () => {
  it("keeps the aggregate tsc-clean after adding a command", async () => {
    const projectDir = await makeProject();
    await addCommandToAggregate(
      "CancelShop",
      path.join(
        projectDir,
        "src",
        "domain",
        "write-model",
        "aggregates",
        "shop",
      ),
      { eventName: "ShopCancelled" },
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("addQueryToProjection", () => {
  it("keeps the projection tsc-clean after adding a query", async () => {
    const projectDir = await makeProject();
    await addQueryToProjection(
      "GetShopSummary",
      path.join(
        projectDir,
        "src",
        "domain",
        "read-model",
        "projections",
        "shop",
      ),
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});

describe("addEventHandlerToProjection", () => {
  it("keeps the projection tsc-clean after adding an event handler", async () => {
    const projectDir = await makeProject();
    await addEventHandlerToProjection(
      "ShopRenamed",
      path.join(
        projectDir,
        "src",
        "domain",
        "read-model",
        "projections",
        "shop",
      ),
    );
    const result = await typecheckProject(projectDir);
    expect(result.ok, result.output).toBe(true);
  });
});
