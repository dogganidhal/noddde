import type { TemplateContext } from "../../utils/context.js";
import type { EventBusAdapter } from "../../utils/event-bus.js";
import type { PersistenceAdapter } from "../../utils/persistence.js";
import { getCliMajorVersion } from "../../utils/cli-version.js";

/** Generates package.json content with correct deps for the chosen adapters. */
export function packageJsonTemplate(
  ctx: TemplateContext,
  adapter: PersistenceAdapter,
  eventBus: EventBusAdapter = "event-emitter",
): string {
  // @noddde/* packages are versioned independently but cut a GA release
  // together, so anchoring every generated range to the CLI's own major
  // version is the range that's actually installable at scaffold time.
  const nodddeRange = `^${getCliMajorVersion()}.0.0`;

  const deps: Record<string, string> = {
    "@noddde/core": nodddeRange,
    "@noddde/engine": nodddeRange,
  };

  const devDeps: Record<string, string> = {
    "@noddde/testing": nodddeRange,
    "@types/node": "^20.11.17",
    eslint: "^8.56.0",
    tsx: "^4.21.0",
    typescript: "^5.3.3",
    vitest: "^4.1.0",
  };

  if (adapter === "prisma") {
    deps["@noddde/prisma"] = nodddeRange;
    deps["@prisma/client"] = "^6.5.0";
    devDeps["prisma"] = "^6.5.0";
  } else if (adapter === "drizzle") {
    deps["@noddde/drizzle"] = nodddeRange;
    deps["drizzle-orm"] = "^0.40.0";
    deps["better-sqlite3"] = "^11.0.0";
    devDeps["@types/better-sqlite3"] = "^7.6.13";
  } else if (adapter === "typeorm") {
    deps["@noddde/typeorm"] = nodddeRange;
  }

  if (eventBus === "kafka") {
    deps["@noddde/kafka"] = nodddeRange;
    deps["kafkajs"] = "^2.0.0";
  } else if (eventBus === "nats") {
    deps["@noddde/nats"] = nodddeRange;
    deps["nats"] = "^2.0.0";
  } else if (eventBus === "rabbitmq") {
    deps["@noddde/rabbitmq"] = nodddeRange;
    deps["amqplib"] = "^0.10.0";
    devDeps["@types/amqplib"] = "^0.10.0";
  }

  const sortedDeps = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedDevDeps = Object.fromEntries(
    Object.entries(devDeps).sort(([a], [b]) => a.localeCompare(b)),
  );

  const pkg = {
    name: ctx.kebabName,
    version: "0.0.0",
    private: true,
    scripts: {
      build: "tsc",
      lint: "eslint . --max-warnings 0",
      start: "tsx src/main.ts",
      test: "vitest run",
      "test:watch": "vitest",
    },
    dependencies: sortedDeps,
    devDependencies: sortedDevDeps,
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}
